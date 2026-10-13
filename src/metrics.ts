import http from 'node:http';
import type { DatabaseInstance } from './db.js';
import type { Config } from './types.js';
import {
  getLastActionTimestamps,
  getConsecutiveCompletedDays,
  getLatestRun,
} from './db.js';
import { loadRegistry, isCurrentUtcCycleCompleted, getCurrentUtcDateKey } from './registry.js';

export interface MetricsStateProvider {
  getNextTargetDate?: () => Date | null;
  getConsecutiveFailures?: () => number;
}

/**
 * Generates Prometheus exposition format metrics text.
 */
export function generatePrometheusMetrics(
  db: DatabaseInstance,
  provider: MetricsStateProvider = {}
): string {
  const registry = loadRegistry();
  const consecutive = getConsecutiveCompletedDays(db);
  const timestamps = getLastActionTimestamps(db);
  const latestRun = getLatestRun(db);
  const todayUtc = getCurrentUtcDateKey();
  const cycleComplete = isCurrentUtcCycleCompleted();

  const targetDays = 90;
  const minStreak = Math.min(consecutive.visit, consecutive.like, consecutive.comment);
  const daysRemaining = Math.max(0, targetDays - minStreak);

  const lines: string[] = [];

  // Helper to append a gauge metric
  const gauge = (name: string, help: string, value: number, labels?: Record<string, string>) => {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} gauge`);
    if (labels && Object.keys(labels).length > 0) {
      const labelStr = Object.entries(labels)
        .map(([k, v]) => `${k}="${v}"`)
        .join(',');
      lines.push(`${name}{${labelStr}} ${value}`);
    } else {
      lines.push(`${name} ${value}`);
    }
  };

  // Helper to parse ISO string to epoch seconds
  const toEpochSeconds = (iso: string | null | undefined): number => {
    if (!iso) return 0;
    const ms = new Date(iso).getTime();
    return Number.isNaN(ms) ? 0 : Math.floor(ms / 1000);
  };

  // 1. Service liveness & process uptime
  gauge('aws_streak_up', 'Operational heartbeat status of the streak daemon (1=running)', 1);
  gauge('aws_streak_process_uptime_seconds', 'Process uptime of the streak daemon in seconds', Math.floor(process.uptime()));
  gauge('aws_streak_process_memory_rss_bytes', 'Resident set size memory usage in bytes', process.memoryUsage().rss);

  // 2. Streaks and goals
  lines.push('# HELP aws_streak_days Current consecutive completed streak days by action type');
  lines.push('# TYPE aws_streak_days gauge');
  lines.push(`aws_streak_days{type="visit"} ${consecutive.visit}`);
  lines.push(`aws_streak_days{type="like"} ${consecutive.like}`);
  lines.push(`aws_streak_days{type="comment"} ${consecutive.comment}`);

  gauge('aws_streak_target_days', 'Overall streak milestone target in days', targetDays);
  gauge('aws_streak_days_remaining', 'Days remaining to achieve the 90-day milestone', daysRemaining);

  // 3. Today UTC completion status (1=completed, 0=pending)
  gauge(
    'aws_streak_today_completed',
    'Whether the current UTC 24h cycle is completed (1=yes, 0=no)',
    cycleComplete ? 1 : 0,
    { utc_date: todayUtc }
  );

  lines.push('# HELP aws_streak_action_completed Whether specific action completed in current UTC 24h lapse');
  lines.push('# TYPE aws_streak_action_completed gauge');
  const cycleActions = registry.currentCycle?.actions;
  lines.push(`aws_streak_action_completed{action="visit"} ${cycleActions?.visit?.completed ? 1 : 0}`);
  lines.push(`aws_streak_action_completed{action="like"} ${cycleActions?.like?.completed ? 1 : 0}`);
  lines.push(`aws_streak_action_completed{action="comment"} ${cycleActions?.comment?.completed ? 1 : 0}`);
  lines.push(`aws_streak_action_completed{action="verify"} ${cycleActions?.verify?.completed ? 1 : 0}`);

  // 4. Action timestamps (epoch seconds)
  lines.push('# HELP aws_streak_last_action_timestamp_seconds Unix timestamp of last completed action');
  lines.push('# TYPE aws_streak_last_action_timestamp_seconds gauge');
  lines.push(`aws_streak_last_action_timestamp_seconds{action="authenticate"} ${toEpochSeconds(timestamps.authenticated)}`);
  lines.push(`aws_streak_last_action_timestamp_seconds{action="visit"} ${toEpochSeconds(timestamps.visit)}`);
  lines.push(`aws_streak_last_action_timestamp_seconds{action="like"} ${toEpochSeconds(timestamps.like)}`);
  lines.push(`aws_streak_last_action_timestamp_seconds{action="comment"} ${toEpochSeconds(timestamps.comment)}`);
  lines.push(`aws_streak_last_action_timestamp_seconds{action="verify"} ${toEpochSeconds(timestamps.verify)}`);

  // 5. Last run details
  if (latestRun) {
    gauge('aws_streak_last_run_timestamp_seconds', 'Unix timestamp when the last streak run started', toEpochSeconds(latestRun.started_at));
    gauge('aws_streak_last_run_duration_seconds', 'Duration of last run in seconds', latestRun.duration_ms ? latestRun.duration_ms / 1000 : 0);

    lines.push('# HELP aws_streak_last_run_status Status indicator of the latest run (1 for active status)');
    lines.push('# TYPE aws_streak_last_run_status gauge');
    lines.push(`aws_streak_last_run_status{status="completed"} ${latestRun.status === 'completed' ? 1 : 0}`);
    lines.push(`aws_streak_last_run_status{status="partial"} ${latestRun.status === 'partial' ? 1 : 0}`);
    lines.push(`aws_streak_last_run_status{status="failed"} ${latestRun.status === 'failed' ? 1 : 0}`);
  }

  // 6. Next scheduled target
  if (provider.getNextTargetDate) {
    const nextDate = provider.getNextTargetDate();
    if (nextDate) {
      gauge('aws_streak_next_execution_timestamp_seconds', 'Target Unix timestamp for the next scheduled streak execution', Math.floor(nextDate.getTime() / 1000));
      const secondsUntil = Math.max(0, Math.floor((nextDate.getTime() - Date.now()) / 1000));
      gauge('aws_streak_seconds_until_next_run', 'Remaining seconds until the next execution', secondsUntil);
    }
  }

  // 7. Scheduler health & failures
  const failures = provider.getConsecutiveFailures ? provider.getConsecutiveFailures() : 0;
  gauge('aws_streak_consecutive_failures', 'Number of consecutive execution failures in current cycle', failures);
  gauge('aws_streak_total_history_days', 'Total number of calendar days tracked in local registry', Object.keys(registry.history || {}).length);

  return lines.join('\n') + '\n';
}

export interface MetricsServerInstance {
  server: http.Server;
  port: number;
  stop: () => Promise<void>;
}

/**
 * Starts an embedded HTTP metrics exporter server for Prometheus.
 */
export function startMetricsServer(
  config: Config,
  db: DatabaseInstance,
  provider: MetricsStateProvider = {}
): MetricsServerInstance | null {
  const enabled = config.metrics?.enabled ?? true;
  if (!enabled) {
    return null;
  }

  const port = config.metrics?.port ?? 9091;

  const server = http.createServer((req, res) => {
    const url = req.url || '/';

    if (url === '/metrics') {
      try {
        const body = generatePrometheusMetrics(db, provider);
        res.writeHead(200, {
          'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        });
        res.end(body);
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Internal Server Error: ${err.message}\n`);
      }
      return;
    }

    if (url === '/health' || url === '/live') {
      const isComplete = isCurrentUtcCycleCompleted();
      const payload = {
        status: 'healthy',
        uptime: Math.floor(process.uptime()),
        utcDate: getCurrentUtcDateKey(),
        cycleComplete: isComplete,
        timestamp: new Date().toISOString(),
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload, null, 2) + '\n');
      return;
    }

    if (url === '/' || url === '/status') {
      const reg = loadRegistry();
      const payload = {
        service: 'aws-builder-streak-agent',
        endpoints: ['/metrics', '/health'],
        currentUtcDate: reg.currentUtcDate,
        cycleStatus: reg.currentCycle?.status,
        streaks: reg.currentCycle?.streaks,
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload, null, 2) + '\n');
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found\n');
  });

  server.listen(port, '0.0.0.0', () => {
    process.stdout.write(`[METRICS] 📊 Prometheus metrics server listening on http://0.0.0.0:${port}/metrics\n`);
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      process.stderr.write(`[METRICS WARNING] Port ${port} is already in use. Metrics server disabled.\n`);
    } else {
      process.stderr.write(`[METRICS ERROR] Server failed: ${err.message}\n`);
    }
  });

  const stop = () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
    });

  return { server, port, stop };
}
