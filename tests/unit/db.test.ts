import { describe, it, expect, beforeEach } from 'vitest';
import {
  initDb,
  insertRun,
  updateRun,
  insertStep,
  insertInteraction,
  getInteractedPostIds,
  insertEvent,
  getLatestRun,
  getStepsByRunId,
  getEventsByRunId,
  getTodayCompletedRun,
} from '../../src/db.js';
import type { DatabaseInstance } from '../../src/db.js';

describe('SQLite Database Layer', () => {
  let db: DatabaseInstance;

  beforeEach(() => {
    // In-memory database for testing
    db = initDb(':memory:');
  });

  it('should insert and retrieve a run record', () => {
    const runId = 'test-run-1';
    insertRun(db, {
      run_id: runId,
      scheduled_at: '2026-09-11T10:45:00Z',
      started_at: '2026-09-11T10:47:00Z',
      completed_at: null,
      duration_ms: null,
      status: 'running',
      streak_visit_before: 5,
      streak_like_before: 5,
      streak_comment_before: 5,
      streak_visit_after: null,
      streak_like_after: null,
      streak_comment_after: null,
      error_message: null,
      error_stack: null,
    });

    const latest = getLatestRun(db);
    expect(latest).not.toBeNull();
    expect(latest?.run_id).toBe(runId);
    expect(latest?.status).toBe('running');
    expect(latest?.streak_visit_before).toBe(5);

    // Update run
    updateRun(db, runId, {
      status: 'completed',
      duration_ms: 12000,
      streak_visit_after: 6,
    });

    const updated = getLatestRun(db);
    expect(updated?.status).toBe('completed');
    expect(updated?.duration_ms).toBe(12000);
    expect(updated?.streak_visit_after).toBe(6);
  });

  it('should insert and query steps by run_id', () => {
    const runId = 'test-run-2';
    insertRun(db, {
      run_id: runId,
      scheduled_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      completed_at: null,
      duration_ms: null,
      status: 'running',
      streak_visit_before: 0,
      streak_like_before: 0,
      streak_comment_before: 0,
      streak_visit_after: null,
      streak_like_after: null,
      streak_comment_after: null,
      error_message: null,
      error_stack: null,
    });

    insertStep(db, {
      run_id: runId,
      step_name: 'authenticate',
      sequence_number: 1,
      status: 'completed',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: 1200,
      retry_count: 0,
      error_type: null,
      error_message: null,
      result_data: null,
    });

    insertStep(db, {
      run_id: runId,
      step_name: 'visit',
      sequence_number: 2,
      status: 'completed',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: 2500,
      retry_count: 0,
      error_type: null,
      error_message: null,
      result_data: null,
    });

    const steps = getStepsByRunId(db, runId);
    expect(steps.length).toBe(2);
    expect(steps[0].step_name).toBe('authenticate');
    expect(steps[1].step_name).toBe('visit');
  });

  it('should enforce UNIQUE constraint on interactions(post_id, action_type)', () => {
    const runId = 'test-run-3';
    insertRun(db, {
      run_id: runId,
      scheduled_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      completed_at: null,
      duration_ms: null,
      status: 'running',
      streak_visit_before: 0,
      streak_like_before: 0,
      streak_comment_before: 0,
      streak_visit_after: null,
      streak_like_after: null,
      streak_comment_after: null,
      error_message: null,
      error_stack: null,
    });

    insertInteraction(db, {
      run_id: runId,
      post_id: 'post-123',
      post_url: 'https://builder.aws.com/post/123',
      post_title: 'Title',
      action_type: 'like',
      comment_text: null,
      created_at: new Date().toISOString(),
    });

    const likedIds = getInteractedPostIds(db, 'like');
    expect(likedIds).toContain('post-123');

    // Attempting duplicate like on same post_id must throw UNIQUE constraint violation
    expect(() => {
      insertInteraction(db, {
        run_id: runId,
        post_id: 'post-123',
        post_url: 'https://builder.aws.com/post/123',
        post_title: 'Duplicate',
        action_type: 'like',
        comment_text: null,
        created_at: new Date().toISOString(),
      });
    }).toThrow(/UNIQUE constraint/i);
  });

  it('should allow liking and commenting on the same post_id once each', () => {
    const runId = 'test-run-4';
    insertRun(db, {
      run_id: runId,
      scheduled_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      completed_at: null,
      duration_ms: null,
      status: 'running',
      streak_visit_before: 0,
      streak_like_before: 0,
      streak_comment_before: 0,
      streak_visit_after: null,
      streak_like_after: null,
      streak_comment_after: null,
      error_message: null,
      error_stack: null,
    });

    // Liking post-456
    expect(() =>
      insertInteraction(db, {
        run_id: runId,
        post_id: 'post-456',
        post_url: null,
        post_title: 'Same Post',
        action_type: 'like',
        comment_text: null,
        created_at: new Date().toISOString(),
      })
    ).not.toThrow();

    // Commenting on post-456
    expect(() =>
      insertInteraction(db, {
        run_id: runId,
        post_id: 'post-456',
        post_url: null,
        post_title: 'Same Post',
        action_type: 'comment',
        comment_text: 'Insightful thoughts.',
        created_at: new Date().toISOString(),
      })
    ).not.toThrow();

    expect(getInteractedPostIds(db, 'like')).toContain('post-456');
    expect(getInteractedPostIds(db, 'comment')).toContain('post-456');
  });

  it('should insert and query append-only events', () => {
    const runId = 'test-run-5';
    insertRun(db, {
      run_id: runId,
      scheduled_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      completed_at: null,
      duration_ms: null,
      status: 'running',
      streak_visit_before: 0,
      streak_like_before: 0,
      streak_comment_before: 0,
      streak_visit_after: null,
      streak_like_after: null,
      streak_comment_after: null,
      error_message: null,
      error_stack: null,
    });

    insertEvent(db, {
      run_id: runId,
      event_type: 'task.started',
      step_name: null,
      sequence_number: 1,
      timestamp: new Date().toISOString(),
      duration_ms: null,
      payload: null,
    });

    insertEvent(db, {
      run_id: runId,
      event_type: 'task.step.completed',
      step_name: 'visit',
      sequence_number: 2,
      timestamp: new Date().toISOString(),
      duration_ms: 1500,
      payload: JSON.stringify({ status: 'ok' }),
    });

    const events = getEventsByRunId(db, runId);
    expect(events.length).toBe(2);
    expect(events[0].event_type).toBe('task.started');
    expect(events[1].event_type).toBe('task.step.completed');
    expect(events[1].sequence_number).toBe(2);
  });
});
