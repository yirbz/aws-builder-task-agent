import type { DatabaseInstance } from './db.js';
import { insertEvent } from './db.js';
import type { EventType, StepName, ErrorType } from './types.js';

export interface EventEmitter {
  taskStarted(): void;
  stepStarted(stepName: StepName): void;
  stepCompleted(stepName: StepName, durationMs: number, resultData?: Record<string, unknown>): void;
  stepFailed(
    stepName: StepName,
    durationMs: number,
    errorType: ErrorType,
    errorMessage: string,
    retryCount: number
  ): void;
  taskCompleted(durationMs: number, streaks: { visit: number; like: number; comment: number }): void;
  taskFailed(
    durationMs: number,
    errorMessage: string,
    stepsCompleted: number,
    stepsFailed: number
  ): void;
}

export function emitEvent(
  db: DatabaseInstance,
  runId: string,
  sequenceNumber: number,
  eventType: EventType,
  stepName?: StepName | null,
  durationMs?: number | null,
  payloadObj?: Record<string, unknown> | null
): void {
  const timestamp = new Date().toISOString();
  const payloadStr = payloadObj ? JSON.stringify(payloadObj) : null;

  // 1. Output structured JSON line to stdout (Constitutional requirement)
  const stdoutRecord: Record<string, unknown> = {
    event: eventType,
    runId,
    timestamp,
    sequenceNumber,
  };
  if (stepName) stdoutRecord.stepName = stepName;
  if (durationMs !== undefined && durationMs !== null) stdoutRecord.durationMs = durationMs;
  if (payloadObj) stdoutRecord.payload = payloadObj;

  process.stdout.write(`${JSON.stringify(stdoutRecord)}\n`);

  // 2. Persist append-only record to events table in SQLite
  insertEvent(db, {
    run_id: runId,
    event_type: eventType,
    step_name: stepName ?? null,
    sequence_number: sequenceNumber,
    timestamp,
    duration_ms: durationMs ?? null,
    payload: payloadStr,
  });
}

export function createEventEmitter(db: DatabaseInstance, runId: string): EventEmitter {
  let sequence = 0;

  const nextSeq = () => {
    sequence += 1;
    return sequence;
  };

  return {
    taskStarted(): void {
      emitEvent(db, runId, nextSeq(), 'task.started');
    },

    stepStarted(stepName: StepName): void {
      emitEvent(db, runId, nextSeq(), 'task.step.started', stepName);
    },

    stepCompleted(stepName: StepName, durationMs: number, resultData?: Record<string, unknown>): void {
      emitEvent(db, runId, nextSeq(), 'task.step.completed', stepName, durationMs, resultData ?? null);
    },

    stepFailed(
      stepName: StepName,
      durationMs: number,
      errorType: ErrorType,
      errorMessage: string,
      retryCount: number
    ): void {
      emitEvent(db, runId, nextSeq(), 'task.step.failed', stepName, durationMs, {
        errorType,
        errorMessage,
        retryCount,
      });
    },

    taskCompleted(durationMs: number, streaks: { visit: number; like: number; comment: number }): void {
      emitEvent(db, runId, nextSeq(), 'task.completed', null, durationMs, { streaks });
    },

    taskFailed(
      durationMs: number,
      errorMessage: string,
      stepsCompleted: number,
      stepsFailed: number
    ): void {
      emitEvent(db, runId, nextSeq(), 'task.failed', null, durationMs, {
        errorMessage,
        stepsCompleted,
        stepsFailed,
      });
    },
  };
}
