import type { ErrorType } from './types.js';
import type { EventEmitter } from './events.js';
import { randomDelay } from './human-behavior.js';

export class StepExecutionError extends Error {
  public errorType: ErrorType;
  public retryCount: number;
  public stepName: string;
  public originalError: unknown;

  constructor(
    message: string,
    stepName: string,
    errorType: ErrorType,
    retryCount: number,
    originalError?: unknown
  ) {
    super(message);
    this.name = 'StepExecutionError';
    this.stepName = stepName;
    this.errorType = errorType;
    this.retryCount = retryCount;
    this.originalError = originalError;
  }
}

export function classifyError(error: unknown): ErrorType {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();

  // Terminal conditions: Cannot be resolved by quick automatic retry
  if (
    message.includes('auth') ||
    message.includes('redirect') ||
    message.includes('401') ||
    message.includes('403') ||
    message.includes('unique constraint') ||
    message.includes('dedup collision') ||
    message.includes('account blocked') ||
    message.includes('rate limited') ||
    message.includes('no unliked articles available') ||
    message.includes('no uninteracted articles available') ||
    message.includes('content pool exhausted')
  ) {
    return 'terminal';
  }

  // Transient network / DOM conditions: Retryable
  return 'retryable';
}

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  stepName: string;
  emitter?: EventEmitter;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { maxAttempts, baseDelayMs, maxDelayMs, stepName, emitter } = options;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      const errorType = classifyError(err);

      if (errorType === 'terminal' || attempt >= maxAttempts) {
        throw new StepExecutionError(
          `Step "${stepName}" failed permanently: ${err.message || String(err)}`,
          stepName,
          errorType,
          attempt - 1,
          err
        );
      }

      // Calculate exponential backoff with jitter
      const rawDelay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      const jitterFactor = 0.8 + Math.random() * 0.4; // 80% to 120%
      const delayMs = Math.floor(rawDelay * jitterFactor);

      process.stderr.write(
        `[WARN] Step "${stepName}" attempt ${attempt}/${maxAttempts} failed (${err.message || String(err)}). Retrying in ${(delayMs / 1000).toFixed(1)}s...\n`
      );

      await randomDelay(delayMs, delayMs + 50);
    }
  }

  throw new StepExecutionError(
    `Step "${stepName}" exhausted all ${maxAttempts} retry attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    stepName,
    'retryable',
    maxAttempts - 1,
    lastError
  );
}
