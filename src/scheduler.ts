import fs from 'node:fs';
import path from 'node:path';
import type { Config } from './types.js';
import {
  initDb,
  getTodayCompletedRun,
  getLastActionTimestamps,
  getLatestRun,
} from './db.js';
import { runDailyStreak } from './streak-runner.js';
import { randomWindowDelay } from './human-behavior.js';
import {
  isCurrentUtcCycleCompleted,
  syncRegistryFromDb,
  getCurrentUtcDateKey,
} from './registry.js';
import { startMetricsServer } from './metrics.js';

export const MAX_RECOVERY_ATTEMPTS = 5;

export interface NextScheduleCalculation {
  targetDate: Date;
  jitterMs: number;
  totalWaitMs: number;
}

export function calculateNextExecution(config: Config): NextScheduleCalculation {
  const [targetHour, targetMinute] = config.schedule.windowStart
    .split(':')
    .map((s) => Number.parseInt(s, 10));

  // Determine current time in the configured timezone
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: config.schedule.timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const getPart = (type: string) =>
    Number.parseInt(parts.find((p) => p.type === type)?.value || '0', 10);

  const curHour = getPart('hour');
  const curMinute = getPart('minute');

  let daysToAdd = 0;
  if (curHour > targetHour || (curHour === targetHour && curMinute >= targetMinute)) {
    daysToAdd = 1;
  }

  // Jitter between 0 and windowMinutes (min 45 mins)
  const jitterMs = randomWindowDelay(config.schedule.windowMinutes);

  // Compute time difference
  const baseWaitMs =
    (daysToAdd * 24 + (targetHour - curHour)) * 60 * 60 * 1000 +
    (targetMinute - curMinute) * 60 * 1000 -
    getPart('second') * 1000;

  const totalWaitMs = Math.max(1000, baseWaitMs + jitterMs);

  return {
    targetDate: new Date(now.getTime() + totalWaitMs),
    jitterMs,
    totalWaitMs,
  };
}

export function isCatchupNeeded(config: Config, db: ReturnType<typeof initDb>): {
  needed: boolean;
  reason: string;
} {
  const isMemoryDb = (db as any).memory === true || config.database.path === ':memory:';
  const todayRun = getTodayCompletedRun(db);
  const cycleComplete = !isMemoryDb && isCurrentUtcCycleCompleted();
  if ((todayRun && todayRun.status === 'completed') || cycleComplete) {
    return {
      needed: false,
      reason: `Today's UTC run already completed for ${getCurrentUtcDateKey()} (Run ID: ${todayRun?.run_id || 'utc-registry'})`,
    };
  }

  const [targetHour, targetMinute] = config.schedule.windowStart
    .split(':')
    .map((s) => Number.parseInt(s, 10));

  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: config.schedule.timezone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const curHour = Number.parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
  const curMinute = Number.parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);

  const windowAlreadyOpen =
    curHour > targetHour || (curHour === targetHour && curMinute >= targetMinute);

  const latestRun = getLatestRun(db);
  const hoursSinceLastRun = latestRun
    ? (Date.now() - new Date(latestRun.started_at).getTime()) / (1000 * 60 * 60)
    : 999;

  if (windowAlreadyOpen || hoursSinceLastRun >= 22) {
    return {
      needed: true,
      reason: windowAlreadyOpen
        ? `Scheduled window ${config.schedule.windowStart} ${config.schedule.timezone} is open/passed and today's run is incomplete`
        : `Last run was ${hoursSinceLastRun.toFixed(1)}h ago and today is incomplete`,
    };
  }

  return { needed: false, reason: `Waiting for today's scheduled window at ${config.schedule.windowStart}` };
}

export function startScheduler(config: Config): void {
  const db = initDb(config.database.path);

  // Synchronize local JSON registry from SQLite on startup
  syncRegistryFromDb(db);

  let consecutiveFailures = 0;
  let activeTimer: NodeJS.Timeout | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let nextTargetDate: Date | null = null;

  const logStatusSummary = () => {
    const ts = getLastActionTimestamps(db);
    const authStr = ts.authenticated ? ts.authenticated.slice(0, 19).replace('T', ' ') : 'None';
    const visitStr = ts.visit ? ts.visit.slice(0, 19).replace('T', ' ') : 'None';
    const likeStr = ts.like ? ts.like.slice(0, 19).replace('T', ' ') : 'None';
    const commentStr = ts.comment ? ts.comment.slice(0, 19).replace('T', ' ') : 'None';

    const waitHours = nextTargetDate
      ? ((nextTargetDate.getTime() - Date.now()) / 3600000).toFixed(1)
      : 'N/A';

    process.stdout.write(
      `[SCHEDULER HEARTBEAT] 🟢 Daemon active | Next run: ${nextTargetDate ? nextTargetDate.toISOString() : 'N/A'} (in ${waitHours}h) | ` +
        `Last Auth: ${authStr} | Last Visit: ${visitStr} | Last Like: ${likeStr} | Last Comment: ${commentStr}\n`
    );
  };

  const scheduleNext = (delayMs?: number, isRetry: boolean = false) => {
    if (activeTimer) clearTimeout(activeTimer);

    if (delayMs !== undefined) {
      nextTargetDate = new Date(Date.now() + delayMs);
      const mins = (delayMs / 60000).toFixed(1);
      process.stdout.write(
        `[SCHEDULER] ${isRetry ? 'Recovery retry' : 'Execution'} scheduled in ${mins}m (${nextTargetDate.toISOString()})\n`
      );
    } else {
      const { targetDate, jitterMs, totalWaitMs } = calculateNextExecution(config);
      nextTargetDate = targetDate;
      const jitterMins = (jitterMs / 60000).toFixed(1);
      const waitHours = (totalWaitMs / 3600000).toFixed(2);
      process.stdout.write(
        `[SCHEDULER] Next daily streak execution scheduled for ${targetDate.toISOString()} (in ${waitHours}h, includes ${jitterMins}m jitter)\n`
      );
      delayMs = totalWaitMs;
    }

    activeTimer = setTimeout(async () => {
      process.stdout.write(`[SCHEDULER] 🚀 Starting daily streak task...\n`);
      try {
        const report = await runDailyStreak(config, db);

        if (report.status === 'completed') {
          process.stdout.write(`[SCHEDULER] ✅ Streak run completed successfully (Run ID: ${report.runId}).\n`);
          consecutiveFailures = 0;
          scheduleNext();
        } else {
          process.stderr.write(
            `[SCHEDULER WARNING] Streak run finished with status "${report.status}" (Run ID: ${report.runId}).\n`
          );
          handleFailure();
        }
      } catch (err: any) {
        process.stderr.write(`[SCHEDULER ERROR] Streak run threw unexpected exception: ${err.message}\n`);
        handleFailure();
      }
    }, delayMs);
  };

  const handleFailure = () => {
    consecutiveFailures++;
    if (consecutiveFailures <= MAX_RECOVERY_ATTEMPTS) {
      // Exponential backoff with jitter: 15m, 20m, 25m, 30m...
      const baseMinutes = 15 + consecutiveFailures * 3;
      const jitterMinutes = Math.random() * 5;
      const retryWaitMs = Math.round((baseMinutes + jitterMinutes) * 60 * 1000);
      process.stderr.write(
        `[SCHEDULER RECOVERY] ⚠️ Scheduling auto-recovery attempt ${consecutiveFailures}/${MAX_RECOVERY_ATTEMPTS} in ${(retryWaitMs / 60000).toFixed(1)}m...\n`
      );
      scheduleNext(retryWaitMs, true);
    } else {
      process.stderr.write(
        `[SCHEDULER ERROR] 🚨 Max recovery attempts (${MAX_RECOVERY_ATTEMPTS}) reached for this cycle. Resuming regular 24h schedule.\n`
      );
      consecutiveFailures = 0;
      scheduleNext();
    }
  };

  // 1. Startup check: check if today's run is overdue or pending
  const catchup = isCatchupNeeded(config, db);
  if (catchup.needed) {
    process.stdout.write(`[SCHEDULER] ⚡ Startup check: ${catchup.reason}. Starting catch-up run in 5 seconds...\n`);
    scheduleNext(5000);
  } else {
    process.stdout.write(`[SCHEDULER] ℹ️ Startup check: ${catchup.reason}.\n`);
    scheduleNext();
  }

  // 2. Start hourly heartbeat
  heartbeatTimer = setInterval(logStatusSummary, 60 * 60 * 1000);

  // 3. Start embedded Prometheus metrics server
  const metricsServer = startMetricsServer(config, db, {
    getNextTargetDate: () => nextTargetDate,
    getConsecutiveFailures: () => consecutiveFailures,
  });

  const cleanup = () => {
    if (activeTimer) clearTimeout(activeTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (metricsServer) {
      metricsServer.stop().catch(() => {});
    }
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

function getBootId(): string | null {
  try {
    if (fs.existsSync('/proc/sys/kernel/random/boot_id')) {
      return fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf-8').trim();
    }
  } catch {}
  return null;
}

function isProcessRunningScheduler(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }

  // On Linux, verify that this PID actually belongs to node/scheduler
  const cmdlinePath = `/proc/${pid}/cmdline`;
  if (fs.existsSync(cmdlinePath)) {
    try {
      const cmdline = fs.readFileSync(cmdlinePath, 'utf-8');
      const isScheduler =
        cmdline.includes('scheduler') ||
        cmdline.includes('streak-agent') ||
        (cmdline.includes('node') &&
          (cmdline.includes('dist/') || cmdline.includes('index.js') || cmdline.includes('cli.js')));
      return isScheduler;
    } catch {
      return false;
    }
  }

  return true;
}

export function acquireSchedulerLock(): boolean {
  const lockFile = path.resolve('./data/.scheduler.lock');
  const currentBootId = getBootId();

  if (fs.existsSync(lockFile)) {
    try {
      const content = fs.readFileSync(lockFile, 'utf-8').trim();
      let isStale = false;

      if (content.startsWith('{')) {
        const data = JSON.parse(content);

        // 1. Check if the lock was created in a previous system boot
        if (currentBootId && data.bootId && data.bootId !== currentBootId) {
          isStale = true;
        } else if (fs.existsSync('/proc/uptime')) {
          try {
            const uptimeSec = Number.parseFloat(fs.readFileSync('/proc/uptime', 'utf-8').split(' ')[0]);
            const bootTimestamp = Date.now() - uptimeSec * 1000;
            if (data.startedAt && new Date(data.startedAt).getTime() < bootTimestamp) {
              isStale = true;
            }
          } catch {}
        }

        // 2. Check if process is still running and actually running the scheduler
        if (!isStale && data.pid) {
          if (!isProcessRunningScheduler(data.pid)) {
            isStale = true;
          }
        }
      } else {
        // Legacy plain PID format
        const pid = Number.parseInt(content, 10);
        if (!pid || !isProcessRunningScheduler(pid)) {
          isStale = true;
        }
      }

      if (!isStale) {
        return false; // Valid scheduler process is currently running
      }
    } catch {
      // Process does not exist or unparseable, lock is stale
    }
  }

  const lockData = JSON.stringify({
    hostname: process.env.HOSTNAME || 'localhost',
    pid: process.pid,
    bootId: currentBootId,
    startedAt: new Date().toISOString(),
  });

  fs.writeFileSync(lockFile, lockData);

  const cleanup = () => {
    try {
      if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);
    } catch {}
  };

  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });

  return true;
}
