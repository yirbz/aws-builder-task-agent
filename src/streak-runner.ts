import path from 'node:path';
import fs from 'node:fs';
import { v4 as uuidv4 } from 'uuid';
import type { BrowserContext, Page } from 'rebrowser-playwright';
import type {
  Config,
  ExecutionReport,
  RunStatus,
  StepName,
  StepResult,
} from './types.js';
import type { DatabaseInstance } from './db.js';
import {
  insertRun,
  updateRun,
  insertStep,
  getTodayCompletedRun,
  getLatestRun,
} from './db.js';
import { createEventEmitter, type EventEmitter } from './events.js';
import {
  launchAuthenticatedContext,
  verifyAuthentication,
  persistSession,
  checkTokenFreshness,
  autoLogin,
  getStoredCredentials,
} from './auth.js';
import { executeVisit } from './visit.js';
import { executeLike } from './like.js';
import { executeComment } from './comment.js';
import { executeVerify } from './verify.js';
import { CommentGenerator } from './comment-generator.js';
import { withRetry } from './retry.js';
import { sendNotification } from './notify.js';
import { randomDelay } from './human-behavior.js';

export interface RunOptions {
  dryRun?: boolean;
  force?: boolean;
  singleStep?: StepName;
  verbose?: boolean;
}

export async function runDailyStreak(
  config: Config,
  db: DatabaseInstance,
  options: RunOptions = {}
): Promise<ExecutionReport> {
  const { dryRun = false, force = false, singleStep, verbose = false } = options;

  // Idempotency check: Schedule fidelity
  const todayRun = getTodayCompletedRun(db);
  if (todayRun && !force) {
    process.stderr.write(
      `[INFO] Today's streak execution has already completed successfully (Run ID: ${todayRun.run_id}). Skipping.\n`
    );
    return {
      runId: todayRun.run_id,
      status: 'completed',
      startedAt: todayRun.started_at,
      completedAt: todayRun.completed_at ?? undefined,
      durationMs: todayRun.duration_ms ?? 0,
      steps: [],
      streaks: {
        visit: todayRun.streak_visit_after ?? 0,
        like: todayRun.streak_like_after ?? 0,
        comment: todayRun.streak_comment_after ?? 0,
        target: 90,
      },
    };
  }

  const runId = uuidv4();
  const scheduledAt = new Date().toISOString();
  const startedAt = scheduledAt;
  const startTime = Date.now();

  const previousRun = getLatestRun(db);
  const streakVisitBefore = previousRun?.streak_visit_after ?? previousRun?.streak_visit_before ?? 0;
  const streakLikeBefore = previousRun?.streak_like_after ?? previousRun?.streak_like_before ?? 0;
  const streakCommentBefore = previousRun?.streak_comment_after ?? previousRun?.streak_comment_before ?? 0;

  // Record initial run in database
  insertRun(db, {
    run_id: runId,
    scheduled_at: scheduledAt,
    started_at: startedAt,
    completed_at: null,
    duration_ms: null,
    status: 'running',
    streak_visit_before: streakVisitBefore,
    streak_like_before: streakLikeBefore,
    streak_comment_before: streakCommentBefore,
    streak_visit_after: null,
    streak_like_after: null,
    streak_comment_after: null,
    error_message: null,
    error_stack: null,
  });

  const emitter = createEventEmitter(db, runId);
  emitter.taskStarted();

  const stepsResults: StepResult[] = [];
  let screenshotBuffer: Buffer | undefined;
  let screenshotPath: string | undefined;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  const commentGenerator = new CommentGenerator(config.comments);

  let streaksAfter = {
    visit: streakVisitBefore,
    like: streakLikeBefore,
    comment: streakCommentBefore,
  };

  try {
    if (dryRun) {
      process.stderr.write(`[INFO] Dry-run enabled. Simulating 5 task steps without live mutations.\n`);
      const simulatedSteps: StepName[] = ['authenticate', 'visit', 'like', 'comment', 'verify'];
      let seq = 1;
      for (const sName of simulatedSteps) {
        emitter.stepStarted(sName);
        await randomDelay(200, 500);
        emitter.stepCompleted(sName, 350, { dryRun: true });
        const stepRes: StepResult = {
          name: sName,
          status: 'completed',
          durationMs: 350,
          retryCount: 0,
          resultData: { dryRun: true },
        };
        stepsResults.push(stepRes);
        insertStep(db, {
          run_id: runId,
          step_name: sName,
          sequence_number: seq++,
          status: 'completed',
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          duration_ms: 350,
          retry_count: 0,
          error_type: null,
          error_message: null,
          result_data: JSON.stringify({ dryRun: true }),
        });
      }

      streaksAfter = {
        visit: streakVisitBefore + 1,
        like: streakLikeBefore + 1,
        comment: streakCommentBefore + 1,
      };

      const durationMs = Date.now() - startTime;
      const completedAt = new Date().toISOString();

      updateRun(db, runId, {
        completed_at: completedAt,
        duration_ms: durationMs,
        status: 'completed',
        streak_visit_after: streaksAfter.visit,
        streak_like_after: streaksAfter.like,
        streak_comment_after: streaksAfter.comment,
      });

      emitter.taskCompleted(durationMs, streaksAfter);

      const report: ExecutionReport = {
        runId,
        status: 'completed',
        startedAt,
        completedAt,
        durationMs,
        steps: stepsResults,
        streaks: { ...streaksAfter, target: 90 },
      };

      await sendNotification(config, report);
      return report;
    }

    // Live Execution Pipeline
    const authSetup = await launchAuthenticatedContext(config, false);
    context = authSetup.context;
    page = authSetup.page;

    let seqNumber = 1;

    // Helper to run a step and record it
    const runStep = async (
      name: StepName,
      executor: () => Promise<StepResult>
    ): Promise<StepResult> => {
      const stepStartTime = new Date().toISOString();
      let res: StepResult;
      try {
        res = await withRetry(executor, {
          maxAttempts: config.retry.maxAttempts,
          baseDelayMs: config.retry.baseDelayMs,
          maxDelayMs: config.retry.maxDelayMs,
          stepName: name,
          emitter,
        });
      } catch (stepErr: any) {
        res = {
          name,
          status: 'failed',
          durationMs: Date.now() - new Date(stepStartTime).getTime(),
          retryCount: stepErr.retryCount ?? config.retry.maxAttempts,
          errorType: stepErr.errorType ?? 'retryable',
          errorMessage: stepErr.message,
        };

        // Capture failure screenshot if enabled
        if (config.browser.screenshotOnFailure && page) {
          try {
            const ssDir = path.resolve('./data/screenshots');
            if (!fs.existsSync(ssDir)) fs.mkdirSync(ssDir, { recursive: true });
            const ssFile = path.join(ssDir, `${runId}-${name}.png`);
            await page.screenshot({ path: ssFile, fullPage: true });
            screenshotPath = ssFile;
            screenshotBuffer = fs.readFileSync(ssFile);
          } catch (ssErr: any) {
            process.stderr.write(`[WARN] Could not capture screenshot: ${ssErr.message}\n`);
          }
        }
      }

      insertStep(db, {
        run_id: runId,
        step_name: name,
        sequence_number: seqNumber++,
        status: res.status,
        started_at: stepStartTime,
        completed_at: new Date().toISOString(),
        duration_ms: res.durationMs,
        retry_count: res.retryCount,
        error_type: res.errorType ?? null,
        error_message: res.errorMessage ?? null,
        result_data: res.resultData ? JSON.stringify(res.resultData) : null,
      });

      stepsResults.push(res);
      return res;
    };

    // Step 1: Authenticate
    if (!singleStep || singleStep === 'authenticate') {
      const authRes = await runStep('authenticate', async () => {
        const stepStart = Date.now();
        emitter.stepStarted('authenticate');

        let isAuthenticated = await verifyAuthentication(page!, true);

        // If session is expired, attempt automated re-login with stored credentials
        if (!isAuthenticated) {
          const credentials = getStoredCredentials();
          if (credentials) {
            process.stdout.write(`[AUTH] Session expired. Attempting auto-login with stored credentials...\n`);
            const autoLoginSuccess = await autoLogin(page!, credentials, config.browser.profileDir);
            if (autoLoginSuccess) {
              isAuthenticated = true;
              process.stdout.write(`[AUTH] ✅ Auto-login recovered the session successfully.\n`);
            } else {
              process.stderr.write(`[AUTH] Auto-login failed. Manual re-authentication required.\n`);
            }
          } else {
            process.stderr.write(
              `[AUTH] Session expired and no credentials found in .env file.\n` +
              `[AUTH] To enable auto-login, add AWS_BUILDER_EMAIL and AWS_BUILDER_PASSWORD to your .env file.\n`
            );
          }
        }

        const duration = Date.now() - stepStart;

        if (!isAuthenticated) {
          emitter.stepFailed(
            'authenticate',
            duration,
            'terminal',
            "Authentication session expired. Run 'pnpm run auth' to re-authenticate, or add credentials to .env for auto-login.",
            0
          );
          throw new Error("Authentication session expired. Run 'pnpm run auth' to re-authenticate, or add credentials to .env for auto-login.");
        }

        const freshness = await checkTokenFreshness(page!);
        emitter.stepCompleted('authenticate', duration, {
          lastRefresh: freshness.lastRefresh,
          ageMs: freshness.ageMs,
          autoLoginUsed: !!(getStoredCredentials()),
        });

        return {
          name: 'authenticate',
          status: 'completed',
          durationMs: duration,
          retryCount: 0,
          resultData: { tokenFreshness: freshness },
        };
      });

      if (authRes.status === 'failed') {
        throw new Error(authRes.errorMessage || 'Authentication failed');
      }
    }

    // Step 2: Visit
    if (!singleStep || singleStep === 'visit') {
      await runStep('visit', () => executeVisit(page!, emitter));
    }

    // Step 3: Like
    if (!singleStep || singleStep === 'like') {
      await runStep('like', () => executeLike(page!, db, emitter, runId));
    }

    // Step 4: Comment
    if (!singleStep || singleStep === 'comment') {
      await runStep('comment', () => executeComment(page!, db, commentGenerator, emitter, runId));
    }

    // Step 5: Verify
    if (!singleStep || singleStep === 'verify') {
      const verifyOutput = await executeVerify(page!, emitter);
      streaksAfter = verifyOutput.streaks;
      stepsResults.push(verifyOutput.result);
      insertStep(db, {
        run_id: runId,
        step_name: 'verify',
        sequence_number: seqNumber++,
        status: verifyOutput.result.status,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: verifyOutput.result.durationMs,
        retry_count: 0,
        error_type: verifyOutput.result.errorType ?? null,
        error_message: verifyOutput.result.errorMessage ?? null,
        result_data: JSON.stringify(verifyOutput.streaks),
      });
    }

    // Partial retry pass for non-critical failures
    const failedSteps = stepsResults.filter((s) => s.status === 'failed');
    if (failedSteps.length > 0 && !singleStep) {
      for (const failed of failedSteps) {
        if (failed.name === 'like') {
          process.stderr.write(`[INFO] Retrying previously failed step "like"...\n`);
          await runStep('like', () => executeLike(page!, db, emitter, runId));
        } else if (failed.name === 'comment') {
          process.stderr.write(`[INFO] Retrying previously failed step "comment"...\n`);
          await runStep('comment', () =>
            executeComment(page!, db, commentGenerator, emitter, runId)
          );
        }
      }
    }

    // Save session back to profile
    if (context) {
      await persistSession(context, config.browser.profileDir);
    }
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    const completedAt = new Date().toISOString();

    const failedCount = stepsResults.filter((s) => s.status === 'failed').length;
    const passedCount = stepsResults.filter((s) => s.status === 'completed').length;

    updateRun(db, runId, {
      completed_at: completedAt,
      duration_ms: durationMs,
      status: 'failed',
      error_message: err.message,
      error_stack: err.stack,
    });

    emitter.taskFailed(durationMs, err.message, passedCount, failedCount);

    const report: ExecutionReport = {
      runId,
      status: 'failed',
      startedAt,
      completedAt,
      durationMs,
      steps: stepsResults,
      streaks: { ...streaksAfter, target: 90 },
      errorMessage: err.message,
      errorStack: err.stack,
      screenshotPath,
      screenshotBuffer,
    };

    await sendNotification(config, report, screenshotBuffer);
    return report;
  } finally {
    if (context) {
      try {
        await context.close();
      } catch {}
    }
  }

  // Calculate final status
  const failedSteps = stepsResults.filter((s) => s.status === 'failed');
  const finalStatus: RunStatus =
    failedSteps.length === 0 ? 'completed' : failedSteps.length < stepsResults.length ? 'partial' : 'failed';

  const durationMs = Date.now() - startTime;
  const completedAt = new Date().toISOString();

  updateRun(db, runId, {
    completed_at: completedAt,
    duration_ms: durationMs,
    status: finalStatus,
    streak_visit_after: streaksAfter.visit,
    streak_like_after: streaksAfter.like,
    streak_comment_after: streaksAfter.comment,
  });

  if (finalStatus === 'completed') {
    emitter.taskCompleted(durationMs, streaksAfter);
  } else {
    emitter.taskFailed(durationMs, 'Some steps failed during execution', stepsResults.length - failedSteps.length, failedSteps.length);
  }

  const report: ExecutionReport = {
    runId,
    status: finalStatus,
    startedAt,
    completedAt,
    durationMs,
    steps: stepsResults,
    streaks: { ...streaksAfter, target: 90 },
    screenshotPath,
    screenshotBuffer,
  };

  await sendNotification(config, report, screenshotBuffer);
  return report;
}
