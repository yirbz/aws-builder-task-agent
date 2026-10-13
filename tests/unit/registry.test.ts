import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getCurrentUtcDateKey,
  createEmptyCycleRecord,
  loadRegistry,
  saveRegistry,
  isCurrentUtcCycleCompleted,
  recordActionInRegistry,
  markCycleCompleteInRegistry,
  syncRegistryFromDb,
} from '../../src/registry.js';
import { initDb, insertRun } from '../../src/db.js';
import type { DatabaseInstance } from '../../src/db.js';

describe('UTC Streak Registry Module', () => {
  const testRegistryPath = path.resolve('./data/test-streak-registry.json');
  let db: DatabaseInstance;

  beforeEach(() => {
    db = initDb(':memory:');
    try {
      if (fs.existsSync(testRegistryPath)) fs.unlinkSync(testRegistryPath);
    } catch {}
  });

  afterEach(() => {
    try {
      if (fs.existsSync(testRegistryPath)) fs.unlinkSync(testRegistryPath);
    } catch {}
  });

  it('getCurrentUtcDateKey returns valid YYYY-MM-DD string', () => {
    const key = getCurrentUtcDateKey();
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('createEmptyCycleRecord returns pending cycle structure', () => {
    const cycle = createEmptyCycleRecord('2026-10-13');
    expect(cycle.utcDate).toBe('2026-10-13');
    expect(cycle.status).toBe('pending');
    expect(cycle.actions.visit.completed).toBe(false);
    expect(cycle.actions.like.completed).toBe(false);
    expect(cycle.actions.comment.completed).toBe(false);
  });

  it('loadRegistry creates default registry if file does not exist', () => {
    const reg = loadRegistry(testRegistryPath);
    expect(reg.version).toBe(1);
    expect(reg.currentUtcDate).toBe(getCurrentUtcDateKey());
    expect(reg.currentCycle.status).toBe('pending');
  });

  it('saveRegistry writes atomic file and can be reloaded', () => {
    const reg = loadRegistry(testRegistryPath);
    reg.currentCycle.status = 'in_progress';
    saveRegistry(reg, testRegistryPath);

    expect(fs.existsSync(testRegistryPath)).toBe(true);

    const reloaded = loadRegistry(testRegistryPath);
    expect(reloaded.currentCycle.status).toBe('in_progress');
  });

  it('recordActionInRegistry updates individual action status', () => {
    recordActionInRegistry('visit', { timestamp: new Date().toISOString() }, testRegistryPath);
    recordActionInRegistry('like', { timestamp: new Date().toISOString() }, testRegistryPath);

    const reg = loadRegistry(testRegistryPath);
    expect(reg.currentCycle.actions.visit.completed).toBe(true);
    expect(reg.currentCycle.actions.like.completed).toBe(true);
    expect(reg.currentCycle.actions.comment.completed).toBe(false);
    expect(reg.currentCycle.status).toBe('in_progress');
    expect(isCurrentUtcCycleCompleted(testRegistryPath)).toBe(false);

    recordActionInRegistry('comment', { timestamp: new Date().toISOString() }, testRegistryPath);
    expect(isCurrentUtcCycleCompleted(testRegistryPath)).toBe(true);
  });

  it('markCycleCompleteInRegistry marks entire cycle completed', () => {
    markCycleCompleteInRegistry('test-run-123', { visit: 15, like: 7, comment: 7 }, testRegistryPath);

    const reg = loadRegistry(testRegistryPath);
    expect(reg.currentCycle.status).toBe('completed');
    expect(reg.currentCycle.runId).toBe('test-run-123');
    expect(reg.currentCycle.streaks.visit).toBe(15);
    expect(isCurrentUtcCycleCompleted(testRegistryPath)).toBe(true);
  });

  it('syncRegistryFromDb hydrates registry from completed runs in SQLite', () => {
    insertRun(db, {
      run_id: 'db-completed-run-1',
      scheduled_at: '2026-10-12T15:00:00.000Z',
      started_at: '2026-10-12T15:00:00.000Z',
      completed_at: '2026-10-12T15:00:30.000Z',
      duration_ms: 30000,
      status: 'completed',
      streak_visit_before: 13,
      streak_like_before: 6,
      streak_comment_before: 6,
      streak_visit_after: 14,
      streak_like_after: 7,
      streak_comment_after: 7,
      error_message: null,
      error_stack: null,
    });

    const reg = syncRegistryFromDb(db, testRegistryPath);
    expect(reg.history['2026-10-12']).toBeDefined();
    expect(reg.history['2026-10-12'].status).toBe('completed');
    expect(reg.history['2026-10-12'].streaks.visit).toBe(14);
  });
});
