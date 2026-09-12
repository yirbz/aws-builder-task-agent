import { describe, it, expect, beforeEach } from 'vitest';
import { initDb, getLatestRun, getEventsByRunId, getStepsByRunId } from '../../src/db.js';
import { runDailyStreak } from '../../src/streak-runner.js';
import { DEFAULT_CONFIG } from '../../src/config.js';
import type { DatabaseInstance } from '../../src/db.js';

describe('Streak Runner Pipeline (Integration)', () => {
  let db: DatabaseInstance;

  beforeEach(() => {
    db = initDb(':memory:');
  });

  it('should run a complete dry-run cycle and emit all structured events', async () => {
    const report = await runDailyStreak(DEFAULT_CONFIG, db, { dryRun: true });

    expect(report.status).toBe('completed');
    expect(report.steps.length).toBe(5);
    expect(report.streaks.visit).toBe(1);
    expect(report.streaks.like).toBe(1);
    expect(report.streaks.comment).toBe(1);

    // Verify database records
    const latestRun = getLatestRun(db);
    expect(latestRun).not.toBeNull();
    expect(latestRun?.run_id).toBe(report.runId);
    expect(latestRun?.status).toBe('completed');
    expect(latestRun?.streak_visit_after).toBe(1);

    // Verify steps recorded in SQLite
    const steps = getStepsByRunId(db, report.runId);
    expect(steps.length).toBe(5);
    expect(steps.map((s) => s.step_name)).toEqual([
      'authenticate',
      'visit',
      'like',
      'comment',
      'verify',
    ]);
    expect(steps.every((s) => s.status === 'completed')).toBe(true);

    // Verify events recorded in SQLite
    const events = getEventsByRunId(db, report.runId);
    expect(events.length).toBe(12); // task.started + 5*(started+completed) + task.completed
    expect(events[0].event_type).toBe('task.started');
    expect(events[events.length - 1].event_type).toBe('task.completed');

    // Verify sequence numbers are monotonic
    for (let i = 0; i < events.length; i++) {
      expect(events[i].sequence_number).toBe(i + 1);
    }
  });

  it('should guarantee idempotency by skipping same-day execution without force', async () => {
    // First run
    const firstReport = await runDailyStreak(DEFAULT_CONFIG, db, { dryRun: true });
    expect(firstReport.status).toBe('completed');

    // Second run on the same day without force
    const secondReport = await runDailyStreak(DEFAULT_CONFIG, db, { dryRun: true, force: false });
    expect(secondReport.runId).toBe(firstReport.runId);
    expect(secondReport.status).toBe('completed');
  });

  it('should increment streaks on consecutive forced runs', async () => {
    const run1 = await runDailyStreak(DEFAULT_CONFIG, db, { dryRun: true, force: true });
    expect(run1.streaks.visit).toBe(1);

    const run2 = await runDailyStreak(DEFAULT_CONFIG, db, { dryRun: true, force: true });
    expect(run2.streaks.visit).toBe(2);
    expect(run2.streaks.like).toBe(2);
    expect(run2.streaks.comment).toBe(2);
  });
});
