import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseInstance } from './db.js';
import { getLatestRun, getLastActionTimestamps, getConsecutiveCompletedDays } from './db.js';

export interface UtcActionRecord {
  completed: boolean;
  timestamp: string | null;
  details?: Record<string, any>;
}

export interface UtcCycleRecord {
  utcDate: string; // Format: "YYYY-MM-DD"
  status: 'pending' | 'in_progress' | 'completed' | 'partial' | 'failed';
  runId: string | null;
  completedAt: string | null;
  actions: {
    visit: UtcActionRecord;
    like: UtcActionRecord;
    comment: UtcActionRecord;
    verify: UtcActionRecord;
  };
  streaks: {
    visit: number;
    like: number;
    comment: number;
    target: number;
  };
}

export interface StreakRegistry {
  version: number;
  lastUpdated: string;
  currentUtcDate: string;
  currentCycle: UtcCycleRecord;
  history: Record<string, UtcCycleRecord>; // Keyed by "YYYY-MM-DD"
}

export const DEFAULT_REGISTRY_PATH = './data/streak-registry.json';

export function getCurrentUtcDateKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function getRegistryPath(customPath?: string): string {
  return path.resolve(customPath || DEFAULT_REGISTRY_PATH);
}

export function createEmptyCycleRecord(utcDate: string): UtcCycleRecord {
  return {
    utcDate,
    status: 'pending',
    runId: null,
    completedAt: null,
    actions: {
      visit: { completed: false, timestamp: null },
      like: { completed: false, timestamp: null },
      comment: { completed: false, timestamp: null },
      verify: { completed: false, timestamp: null },
    },
    streaks: {
      visit: 0,
      like: 0,
      comment: 0,
      target: 90,
    },
  };
}

export function loadRegistry(customPath?: string): StreakRegistry {
  const filePath = getRegistryPath(customPath);
  const todayUtc = getCurrentUtcDateKey();

  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw) as StreakRegistry;

      if (!data.history) data.history = {};

      // Ensure currentCycle matches current UTC day
      if (data.currentUtcDate !== todayUtc) {
        // Archive previous cycle if not in history
        if (data.currentCycle && data.currentCycle.utcDate) {
          data.history[data.currentCycle.utcDate] = data.currentCycle;
        }

        data.currentUtcDate = todayUtc;
        data.currentCycle = data.history[todayUtc] || createEmptyCycleRecord(todayUtc);
      }

      return data;
    } catch (err: any) {
      process.stderr.write(`[REGISTRY WARNING] Corrupt or unparseable registry at ${filePath}: ${err.message}. Initializing fresh.\n`);
    }
  }

  // Default fresh registry
  return {
    version: 1,
    lastUpdated: new Date().toISOString(),
    currentUtcDate: todayUtc,
    currentCycle: createEmptyCycleRecord(todayUtc),
    history: {},
  };
}

export function saveRegistry(registry: StreakRegistry, customPath?: string): void {
  const filePath = getRegistryPath(customPath);
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  registry.lastUpdated = new Date().toISOString();
  if (registry.currentCycle) {
    registry.history[registry.currentCycle.utcDate] = registry.currentCycle;
  }

  const tmpPath = `${filePath}.${Date.now()}.tmp`;
  const jsonStr = JSON.stringify(registry, null, 2);

  // Atomic write via temporary file + rename to prevent corruption on power cuts
  fs.writeFileSync(tmpPath, jsonStr, 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

export function isCurrentUtcCycleCompleted(customPath?: string): boolean {
  const registry = loadRegistry(customPath);
  const cycle = registry.currentCycle;

  if (!cycle) return false;

  const allActionsDone =
    cycle.actions.visit.completed &&
    cycle.actions.like.completed &&
    cycle.actions.comment.completed;

  return cycle.status === 'completed' || allActionsDone;
}

export function recordActionInRegistry(
  action: 'visit' | 'like' | 'comment' | 'verify',
  details?: {
    runId?: string;
    timestamp?: string;
    payload?: Record<string, any>;
    streaks?: { visit: number; like: number; comment: number };
  },
  customPath?: string
): StreakRegistry {
  const registry = loadRegistry(customPath);
  const todayUtc = getCurrentUtcDateKey();
  const timestamp = details?.timestamp || new Date().toISOString();

  if (registry.currentUtcDate !== todayUtc) {
    registry.currentUtcDate = todayUtc;
    registry.currentCycle = registry.history[todayUtc] || createEmptyCycleRecord(todayUtc);
  }

  const cycle = registry.currentCycle;
  if (details?.runId) cycle.runId = details.runId;

  cycle.actions[action] = {
    completed: true,
    timestamp,
    details: details?.payload,
  };

  if (details?.streaks) {
    cycle.streaks = { ...details.streaks, target: 90 };
  }

  // Check if all actions are complete
  if (
    cycle.actions.visit.completed &&
    cycle.actions.like.completed &&
    cycle.actions.comment.completed
  ) {
    cycle.status = 'completed';
    if (!cycle.completedAt) cycle.completedAt = timestamp;
  } else if (cycle.status === 'pending') {
    cycle.status = 'in_progress';
  }

  saveRegistry(registry, customPath);
  return registry;
}

export function markCycleCompleteInRegistry(
  runId: string,
  streaks: { visit: number; like: number; comment: number; target?: number },
  customPath?: string
): StreakRegistry {
  const registry = loadRegistry(customPath);
  const todayUtc = getCurrentUtcDateKey();
  const nowIso = new Date().toISOString();

  if (registry.currentUtcDate !== todayUtc) {
    registry.currentUtcDate = todayUtc;
    registry.currentCycle = registry.history[todayUtc] || createEmptyCycleRecord(todayUtc);
  }

  const cycle = registry.currentCycle;
  cycle.runId = runId;
  cycle.status = 'completed';
  cycle.completedAt = nowIso;
  cycle.actions.visit.completed = true;
  if (!cycle.actions.visit.timestamp) cycle.actions.visit.timestamp = nowIso;
  cycle.actions.like.completed = true;
  if (!cycle.actions.like.timestamp) cycle.actions.like.timestamp = nowIso;
  cycle.actions.comment.completed = true;
  if (!cycle.actions.comment.timestamp) cycle.actions.comment.timestamp = nowIso;
  cycle.actions.verify.completed = true;
  if (!cycle.actions.verify.timestamp) cycle.actions.verify.timestamp = nowIso;

  cycle.streaks = {
    visit: streaks.visit,
    like: streaks.like,
    comment: streaks.comment,
    target: streaks.target ?? 90,
  };

  saveRegistry(registry, customPath);
  return registry;
}

/**
 * Hydrates or synchronizes the JSON registry from SQLite database records.
 * Ensures the registry is populated even on fresh starts or re-installs.
 */
export function syncRegistryFromDb(db: DatabaseInstance, customPath?: string): StreakRegistry {
  const registry = loadRegistry(customPath);
  const todayUtc = getCurrentUtcDateKey();

  // Query recent completed runs from DB to populate registry history
  try {
    const rows = db
      .prepare(`
        SELECT run_id, DATE(started_at) as utc_date, started_at, completed_at, status,
               streak_visit_after, streak_like_after, streak_comment_after
        FROM runs
        WHERE status = 'completed'
        ORDER BY started_at ASC
      `)
      .all() as any[];

    for (const row of rows) {
      const utcDate = row.utc_date;
      if (!utcDate) continue;

      if (!registry.history[utcDate] || registry.history[utcDate].status !== 'completed') {
        const cycle = createEmptyCycleRecord(utcDate);
        cycle.runId = row.run_id;
        cycle.status = 'completed';
        cycle.completedAt = row.completed_at || row.started_at;
        cycle.actions.visit = { completed: true, timestamp: row.started_at };
        cycle.actions.like = { completed: true, timestamp: row.completed_at || row.started_at };
        cycle.actions.comment = { completed: true, timestamp: row.completed_at || row.started_at };
        cycle.actions.verify = { completed: true, timestamp: row.completed_at || row.started_at };
        cycle.streaks = {
          visit: row.streak_visit_after ?? 0,
          like: row.streak_like_after ?? 0,
          comment: row.streak_comment_after ?? 0,
          target: 90,
        };
        registry.history[utcDate] = cycle;
      }
    }

    // Check today's status
    const timestamps = getLastActionTimestamps(db);
    const consecutive = getConsecutiveCompletedDays(db);

    if (registry.history[todayUtc]) {
      registry.currentCycle = registry.history[todayUtc];
    } else {
      const cycle = createEmptyCycleRecord(todayUtc);
      if (timestamps.visit && timestamps.visit.startsWith(todayUtc)) {
        cycle.actions.visit = { completed: true, timestamp: timestamps.visit };
      }
      if (timestamps.like && timestamps.like.startsWith(todayUtc)) {
        cycle.actions.like = { completed: true, timestamp: timestamps.like };
      }
      if (timestamps.comment && timestamps.comment.startsWith(todayUtc)) {
        cycle.actions.comment = { completed: true, timestamp: timestamps.comment };
      }
      if (timestamps.verify && timestamps.verify.startsWith(todayUtc)) {
        cycle.actions.verify = { completed: true, timestamp: timestamps.verify };
      }

      if (cycle.actions.visit.completed && cycle.actions.like.completed && cycle.actions.comment.completed) {
        cycle.status = 'completed';
        cycle.completedAt = timestamps.verify || timestamps.comment || new Date().toISOString();
      }

      cycle.streaks = { ...consecutive, target: 90 };
      registry.currentCycle = cycle;
      registry.history[todayUtc] = cycle;
    }

    saveRegistry(registry, customPath);
  } catch (err: any) {
    process.stderr.write(`[REGISTRY WARNING] Failed to sync registry from DB: ${err.message}\n`);
  }

  return registry;
}
