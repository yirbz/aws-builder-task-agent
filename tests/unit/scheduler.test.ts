import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { calculateNextExecution, isCatchupNeeded, acquireSchedulerLock } from '../../src/scheduler.js';
import { initDb, insertRun } from '../../src/db.js';
import { DEFAULT_CONFIG } from '../../src/config.js';
import type { DatabaseInstance } from '../../src/db.js';

describe('Scheduler Module', () => {
  let db: DatabaseInstance;
  const lockFilePath = path.resolve('./data/.scheduler.lock');

  beforeEach(() => {
    db = initDb(':memory:');
    try {
      if (fs.existsSync(lockFilePath)) fs.unlinkSync(lockFilePath);
    } catch {}
  });

  afterEach(() => {
    try {
      if (fs.existsSync(lockFilePath)) fs.unlinkSync(lockFilePath);
    } catch {}
  });

  it('calculateNextExecution returns valid next date and wait time', () => {
    const calc = calculateNextExecution(DEFAULT_CONFIG);
    expect(calc.targetDate).toBeInstanceOf(Date);
    expect(calc.totalWaitMs).toBeGreaterThan(0);
    expect(calc.jitterMs).toBeGreaterThanOrEqual(0);
  });

  it('isCatchupNeeded returns false when today is already completed', () => {
    insertRun(db, {
      run_id: 'completed-today-run',
      scheduled_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: 15000,
      status: 'completed',
      streak_visit_before: 5,
      streak_like_before: 5,
      streak_comment_before: 5,
      streak_visit_after: 6,
      streak_like_after: 6,
      streak_comment_after: 6,
      error_message: null,
      error_stack: null,
    });

    const catchup = isCatchupNeeded(DEFAULT_CONFIG, db);
    expect(catchup.needed).toBe(false);
    expect(catchup.reason).toContain('already completed');
  });

  it('isCatchupNeeded detects overdue or uncompleted runs when last run was long ago', () => {
    const catchup = isCatchupNeeded(DEFAULT_CONFIG, db);
    // Since there are no runs at all, hoursSinceLastRun is 999 >= 22
    expect(catchup.needed).toBe(true);
    expect(catchup.reason).toContain('incomplete');
  });

  it('acquireSchedulerLock succeeds when no lock exists', () => {
    const acquired = acquireSchedulerLock();
    expect(acquired).toBe(true);
    expect(fs.existsSync(lockFilePath)).toBe(true);
  });

  it('acquireSchedulerLock recovers from stale lock with different bootId', () => {
    fs.writeFileSync(
      lockFilePath,
      JSON.stringify({
        hostname: 'previous-box',
        pid: 12345,
        bootId: '00000000-0000-0000-0000-000000000000',
        startedAt: '2020-01-01T00:00:00.000Z',
      })
    );

    const acquired = acquireSchedulerLock();
    expect(acquired).toBe(true);
  });

  it('acquireSchedulerLock recovers from stale lock with dead PID', () => {
    fs.writeFileSync(
      lockFilePath,
      JSON.stringify({
        hostname: 'localhost',
        pid: 999999999,
        startedAt: new Date().toISOString(),
      })
    );

    const acquired = acquireSchedulerLock();
    expect(acquired).toBe(true);
  });
});
