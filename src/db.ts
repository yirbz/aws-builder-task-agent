import Database, { type Database as DatabaseInstance } from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import type {
  Run,
  Step,
  Interaction,
  Event,
  ActionType,
} from './types.js';

export type { DatabaseInstance };

export function initDb(dbPath: string): DatabaseInstance {
  const dir = path.dirname(path.resolve(dbPath));
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Schema creation
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY,
      scheduled_at TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      duration_ms INTEGER,
      status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'completed', 'partial', 'failed')),
      streak_visit_before INTEGER,
      streak_like_before INTEGER,
      streak_comment_before INTEGER,
      streak_visit_after INTEGER,
      streak_like_after INTEGER,
      streak_comment_after INTEGER,
      error_message TEXT,
      error_stack TEXT
    );

    CREATE TABLE IF NOT EXISTS steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
      step_name TEXT NOT NULL CHECK(step_name IN ('authenticate', 'visit', 'like', 'comment', 'verify')),
      sequence_number INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('started', 'completed', 'failed', 'skipped')),
      started_at TEXT NOT NULL,
      completed_at TEXT,
      duration_ms INTEGER,
      retry_count INTEGER NOT NULL DEFAULT 0,
      error_type TEXT CHECK(error_type IS NULL OR error_type IN ('retryable', 'terminal')),
      error_message TEXT,
      result_data TEXT
    );

    CREATE TABLE IF NOT EXISTS interactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES runs(run_id),
      post_id TEXT NOT NULL,
      post_url TEXT,
      post_title TEXT,
      action_type TEXT NOT NULL CHECK(action_type IN ('like', 'comment')),
      comment_text TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT uq_post_action UNIQUE(post_id, action_type)
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES runs(run_id),
      event_type TEXT NOT NULL CHECK(event_type IN ('task.started', 'task.step.started', 'task.step.completed', 'task.step.failed', 'task.completed', 'task.failed')),
      step_name TEXT,
      sequence_number INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      duration_ms INTEGER,
      payload TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
    CREATE INDEX IF NOT EXISTS idx_runs_scheduled_at ON runs(scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_steps_run_id ON steps(run_id);
    CREATE INDEX IF NOT EXISTS idx_interactions_post_id_action ON interactions(post_id, action_type);
    CREATE INDEX IF NOT EXISTS idx_interactions_run_id ON interactions(run_id);
    CREATE INDEX IF NOT EXISTS idx_events_run_id_seq ON events(run_id, sequence_number);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
  `);

  return db;
}

export function insertRun(db: DatabaseInstance, run: Run): void {
  const stmt = db.prepare(`
    INSERT INTO runs (
      run_id, scheduled_at, started_at, completed_at, duration_ms, status,
      streak_visit_before, streak_like_before, streak_comment_before,
      streak_visit_after, streak_like_after, streak_comment_after,
      error_message, error_stack
    ) VALUES (
      @run_id, @scheduled_at, @started_at, @completed_at, @duration_ms, @status,
      @streak_visit_before, @streak_like_before, @streak_comment_before,
      @streak_visit_after, @streak_like_after, @streak_comment_after,
      @error_message, @error_stack
    )
  `);
  stmt.run({
    run_id: run.run_id,
    scheduled_at: run.scheduled_at,
    started_at: run.started_at,
    completed_at: run.completed_at ?? null,
    duration_ms: run.duration_ms ?? null,
    status: run.status,
    streak_visit_before: run.streak_visit_before ?? null,
    streak_like_before: run.streak_like_before ?? null,
    streak_comment_before: run.streak_comment_before ?? null,
    streak_visit_after: run.streak_visit_after ?? null,
    streak_like_after: run.streak_like_after ?? null,
    streak_comment_after: run.streak_comment_after ?? null,
    error_message: run.error_message ?? null,
    error_stack: run.error_stack ?? null,
  });
}

export function updateRun(db: DatabaseInstance, runId: string, fields: Partial<Run>): void {
  const entries = Object.entries(fields).filter(([k]) => k !== 'run_id');
  if (entries.length === 0) return;

  const setClause = entries.map(([k]) => `${k} = ?`).join(', ');
  const values = entries.map(([, v]) => (v === undefined ? null : v));
  values.push(runId);

  const stmt = db.prepare(`UPDATE runs SET ${setClause} WHERE run_id = ?`);
  stmt.run(...values);
}

export function insertStep(db: DatabaseInstance, step: Step): number {
  const stmt = db.prepare(`
    INSERT INTO steps (
      run_id, step_name, sequence_number, status, started_at, completed_at,
      duration_ms, retry_count, error_type, error_message, result_data
    ) VALUES (
      @run_id, @step_name, @sequence_number, @status, @started_at, @completed_at,
      @duration_ms, @retry_count, @error_type, @error_message, @result_data
    )
  `);
  const info = stmt.run({
    run_id: step.run_id,
    step_name: step.step_name,
    sequence_number: step.sequence_number,
    status: step.status,
    started_at: step.started_at,
    completed_at: step.completed_at ?? null,
    duration_ms: step.duration_ms ?? null,
    retry_count: step.retry_count,
    error_type: step.error_type ?? null,
    error_message: step.error_message ?? null,
    result_data: step.result_data ?? null,
  });
  return Number(info.lastInsertRowid);
}

export function updateStep(db: DatabaseInstance, id: number, fields: Partial<Step>): void {
  const entries = Object.entries(fields).filter(([k]) => k !== 'id');
  if (entries.length === 0) return;

  const setClause = entries.map(([k]) => `${k} = ?`).join(', ');
  const values = entries.map(([, v]) => (v === undefined ? null : v));
  values.push(id);

  const stmt = db.prepare(`UPDATE steps SET ${setClause} WHERE id = ?`);
  stmt.run(...values);
}

export function insertInteraction(db: DatabaseInstance, interaction: Interaction): number {
  const stmt = db.prepare(`
    INSERT INTO interactions (
      run_id, post_id, post_url, post_title, action_type, comment_text, created_at
    ) VALUES (
      @run_id, @post_id, @post_url, @post_title, @action_type, @comment_text, @created_at
    )
  `);
  const info = stmt.run({
    run_id: interaction.run_id,
    post_id: interaction.post_id,
    post_url: interaction.post_url ?? null,
    post_title: interaction.post_title ?? null,
    action_type: interaction.action_type,
    comment_text: interaction.comment_text ?? null,
    created_at: interaction.created_at || new Date().toISOString(),
  });
  return Number(info.lastInsertRowid);
}

export function getInteractedPostIds(db: DatabaseInstance, actionType: ActionType): string[] {
  const stmt = db.prepare(`SELECT post_id FROM interactions WHERE action_type = ?`);
  const rows = stmt.all(actionType) as { post_id: string }[];
  return rows.map((r) => r.post_id);
}

export function getAllInteractedCommentTexts(db: DatabaseInstance): string[] {
  const stmt = db.prepare(`SELECT comment_text FROM interactions WHERE action_type = 'comment' AND comment_text IS NOT NULL`);
  const rows = stmt.all() as { comment_text: string }[];
  return rows.map((r) => r.comment_text);
}

export function hasRunInteracted(db: DatabaseInstance, runId: string, actionType: ActionType): boolean {
  const stmt = db.prepare(`SELECT 1 FROM interactions WHERE run_id = ? AND action_type = ? LIMIT 1`);
  return stmt.get(runId, actionType) !== undefined;
}

export function insertEvent(db: DatabaseInstance, event: Event): number {
  const stmt = db.prepare(`
    INSERT INTO events (
      run_id, event_type, step_name, sequence_number, timestamp, duration_ms, payload
    ) VALUES (
      @run_id, @event_type, @step_name, @sequence_number, @timestamp, @duration_ms, @payload
    )
  `);
  const info = stmt.run({
    run_id: event.run_id,
    event_type: event.event_type,
    step_name: event.step_name ?? null,
    sequence_number: event.sequence_number,
    timestamp: event.timestamp,
    duration_ms: event.duration_ms ?? null,
    payload: event.payload ?? null,
  });
  return Number(info.lastInsertRowid);
}

export function getLatestRun(db: DatabaseInstance): Run | null {
  const stmt = db.prepare(`SELECT * FROM runs ORDER BY started_at DESC LIMIT 1`);
  const row = stmt.get() as Run | undefined;
  return row ?? null;
}

export function getRunById(db: DatabaseInstance, runId: string): Run | null {
  const stmt = db.prepare(`SELECT * FROM runs WHERE run_id = ?`);
  const row = stmt.get(runId) as Run | undefined;
  return row ?? null;
}

export function getStepsByRunId(db: DatabaseInstance, runId: string): Step[] {
  const stmt = db.prepare(`SELECT * FROM steps WHERE run_id = ? ORDER BY sequence_number ASC`);
  return stmt.all(runId) as Step[];
}

export function getEventsByRunId(db: DatabaseInstance, runId: string): Event[] {
  const stmt = db.prepare(`SELECT * FROM events WHERE run_id = ? ORDER BY sequence_number ASC`);
  return stmt.all(runId) as Event[];
}

export function getTodayCompletedRun(db: DatabaseInstance): Run | null {
  const stmt = db.prepare(`
    SELECT * FROM runs
    WHERE status = 'completed'
      AND DATE(started_at) = DATE('now')
    ORDER BY started_at DESC
    LIMIT 1
  `);
  const row = stmt.get() as Run | undefined;
  return row ?? null;
}

export function getInteractionCount(db: DatabaseInstance, actionType: ActionType): number {
  const stmt = db.prepare(`SELECT COUNT(*) as count FROM interactions WHERE action_type = ?`);
  const row = stmt.get(actionType) as { count: number };
  return row?.count ?? 0;
}

export function getRecentInteractions(
  db: DatabaseInstance,
  days: number = 30,
  actionType?: ActionType
): Interaction[] {
  let query = `
    SELECT * FROM interactions
    WHERE datetime(created_at) >= datetime('now', '-' || ? || ' days')
  `;
  const params: any[] = [days];

  if (actionType) {
    query += ` AND action_type = ?`;
    params.push(actionType);
  }

  query += ` ORDER BY created_at DESC`;
  const stmt = db.prepare(query);
  return stmt.all(...params) as Interaction[];
}

export function getConsecutiveCompletedDays(db: DatabaseInstance): {
  visit: number;
  like: number;
  comment: number;
} {
  const latest = getLatestRun(db);
  if (!latest) {
    return { visit: 0, like: 0, comment: 0 };
  }

  // Use the verified post-flight streak values if available, or before values
  return {
    visit: latest.streak_visit_after ?? latest.streak_visit_before ?? 0,
    like: latest.streak_like_after ?? latest.streak_like_before ?? 0,
    comment: latest.streak_comment_after ?? latest.streak_comment_before ?? 0,
  };
}
