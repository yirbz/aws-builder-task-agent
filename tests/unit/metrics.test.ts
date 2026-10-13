import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generatePrometheusMetrics, startMetricsServer } from '../../src/metrics.js';
import { initDb, insertRun } from '../../src/db.js';
import { DEFAULT_CONFIG } from '../../src/config.js';
import type { DatabaseInstance } from '../../src/db.js';

describe('Prometheus Metrics Exporter', () => {
  let db: DatabaseInstance;

  beforeEach(() => {
    db = initDb(':memory:');
  });

  it('generatePrometheusMetrics generates valid prometheus text format', () => {
    insertRun(db, {
      run_id: 'test-run-metrics',
      scheduled_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: 12000,
      status: 'completed',
      streak_visit_before: 14,
      streak_like_before: 6,
      streak_comment_before: 6,
      streak_visit_after: 15,
      streak_like_after: 7,
      streak_comment_after: 7,
      error_message: null,
      error_stack: null,
    });

    const output = generatePrometheusMetrics(db, {
      getNextTargetDate: () => new Date(Date.now() + 3600000),
      getConsecutiveFailures: () => 0,
    });

    expect(output).toContain('# HELP aws_streak_up');
    expect(output).toContain('aws_streak_up 1');
    expect(output).toContain('aws_streak_days{type="visit"}');
    expect(output).toContain('aws_streak_target_days 90');
    expect(output).toContain('aws_streak_today_completed');
    expect(output).toContain('aws_streak_last_run_timestamp_seconds');
    expect(output).toContain('aws_streak_next_execution_timestamp_seconds');
  });

  it('startMetricsServer exposes /metrics and /health endpoints', async () => {
    const config = {
      ...DEFAULT_CONFIG,
      metrics: {
        enabled: true,
        port: 19091, // non-conflicting test port
      },
    };

    const serverInstance = startMetricsServer(config, db);
    expect(serverInstance).not.toBeNull();

    try {
      const resHealth = await fetch('http://127.0.0.1:19091/health');
      expect(resHealth.status).toBe(200);
      const jsonHealth = (await resHealth.json()) as any;
      expect(jsonHealth.status).toBe('healthy');

      const resMetrics = await fetch('http://127.0.0.1:19091/metrics');
      expect(resMetrics.status).toBe(200);
      const textMetrics = await resMetrics.text();
      expect(textMetrics).toContain('aws_streak_up 1');
    } finally {
      if (serverInstance) {
        await serverInstance.stop();
      }
    }
  });
});
