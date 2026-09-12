import type { Page } from 'rebrowser-playwright';
import type { StepResult } from './types.js';
import type { EventEmitter } from './events.js';
import { humanScroll, randomDelay } from './human-behavior.js';

export async function executeVisit(
  page: Page,
  emitter: EventEmitter
): Promise<StepResult> {
  const startTime = Date.now();
  emitter.stepStarted('visit');

  try {
    await page.goto('https://builder.aws.com', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Human-like reading behavior
    await humanScroll(page);
    await randomDelay(2000, 5000);

    const durationMs = Date.now() - startTime;
    emitter.stepCompleted('visit', durationMs);

    return {
      name: 'visit',
      status: 'completed',
      durationMs,
      retryCount: 0,
      resultData: { url: page.url() },
    };
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    emitter.stepFailed('visit', durationMs, 'retryable', err.message, 0);

    return {
      name: 'visit',
      status: 'failed',
      durationMs,
      retryCount: 0,
      errorType: 'retryable',
      errorMessage: err.message,
    };
  }
}
