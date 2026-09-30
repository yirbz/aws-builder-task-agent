#!/usr/bin/env node

import path from 'node:path';
import { loadConfig, ensureDirectories } from './config.js';
import {
  initDb,
  getLatestRun,
  getTodayCompletedRun,
  getConsecutiveCompletedDays,
  getRecentInteractions,
  getInteractionCount,
} from './db.js';
import { runDailyStreak } from './streak-runner.js';
import { launchAuthenticatedContext, persistSession, verifyAuthentication } from './auth.js';
import { startScheduler, acquireSchedulerLock } from './scheduler.js';
import type { ActionType, StepName, StreakStatus } from './types.js';

interface CliArgs {
  command: string;
  dryRun: boolean;
  force: boolean;
  step?: StepName;
  verbose: boolean;
  json: boolean;
  configPath?: string;
  days: number;
  action?: ActionType;
  foreground: boolean;
}

function parseArgs(args: string[]): CliArgs {
  const cliArgs: CliArgs = {
    command: 'run',
    dryRun: false,
    force: false,
    verbose: false,
    json: false,
    days: 30,
    foreground: false,
  };

  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') cliArgs.dryRun = true;
    else if (arg === '--force') cliArgs.force = true;
    else if (arg === '--verbose') cliArgs.verbose = true;
    else if (arg === '--json') cliArgs.json = true;
    else if (arg === '--foreground') cliArgs.foreground = true;
    else if (arg === '--config' && i + 1 < args.length) {
      cliArgs.configPath = args[++i];
    } else if (arg === '--step' && i + 1 < args.length) {
      cliArgs.step = args[++i] as StepName;
    } else if (arg === '--days' && i + 1 < args.length) {
      cliArgs.days = Number.parseInt(args[++i], 10) || 30;
    } else if (arg === '--action' && i + 1 < args.length) {
      cliArgs.action = args[++i] as ActionType;
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  if (positional.length > 0) {
    cliArgs.command = positional[0];
  }

  return cliArgs;
}

async function handleRun(cliArgs: CliArgs): Promise<number> {
  let config;
  try {
    config = loadConfig(cliArgs.configPath);
    ensureDirectories(config);
  } catch (err: any) {
    process.stderr.write(`[CONFIG ERROR] ${err.message}\n`);
    return 3;
  }

  const db = initDb(config.database.path);

  try {
    const report = await runDailyStreak(config, db, {
      dryRun: cliArgs.dryRun,
      force: cliArgs.force,
      singleStep: cliArgs.step,
      verbose: cliArgs.verbose,
    });

    if (report.status === 'completed') return 0;
    if (report.status === 'partial') return 1;

    // Check if failure was auth-related
    const authFailed = report.steps.some(
      (s) => s.name === 'authenticate' && s.status === 'failed'
    );
    if (authFailed) return 4;

    return 2;
  } catch (err: any) {
    process.stderr.write(`[EXECUTION ERROR] ${err.message}\n`);
    if (err.message?.includes('Authentication session expired')) {
      return 4;
    }
    return 2;
  }
}

async function handleStatus(cliArgs: CliArgs): Promise<number> {
  const config = loadConfig(cliArgs.configPath);
  const db = initDb(config.database.path);

  const latestRun = getLatestRun(db);
  const todayRun = getTodayCompletedRun(db);
  const consecutive = getConsecutiveCompletedDays(db);

  const targetDays = 90;
  const minStreak = Math.min(consecutive.visit, consecutive.like, consecutive.comment);
  const daysRemaining = Math.max(0, targetDays - minStreak);

  const todayCompleted = Boolean(todayRun && todayRun.status === 'completed');

  const streakStatus: StreakStatus = {
    streaks: {
      visit: { current: consecutive.visit, target: targetDays, todayCompleted },
      like: { current: consecutive.like, target: targetDays, todayCompleted },
      comment: { current: consecutive.comment, target: targetDays, todayCompleted },
    },
    lastRun: latestRun
      ? {
          runId: latestRun.run_id,
          timestamp: latestRun.started_at,
          status: latestRun.status,
        }
      : null,
    nextWindow: {
      start: config.schedule.windowStart,
      end: `${config.schedule.windowStart} (+${config.schedule.windowMinutes}m)`,
    },
    daysRemaining,
  };

  if (cliArgs.json) {
    process.stdout.write(`${JSON.stringify(streakStatus, null, 2)}\n`);
  } else {
    process.stdout.write(`
AWS Badge Streak Agent — Status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Streak          Days    Target    Status
  ──────          ────    ──────    ──────
  Visit           ${consecutive.visit}/${targetDays}   ${targetDays}        ${todayCompleted ? '✅ Today completed' : '⏳ Pending / In-progress'}
  Like            ${consecutive.like}/${targetDays}   ${targetDays}        ${todayCompleted ? '✅ Today completed' : '⏳ Pending / In-progress'}
  Comment         ${consecutive.comment}/${targetDays}   ${targetDays}        ${todayCompleted ? '✅ Today completed' : '⏳ Pending / In-progress'}

  Last run:       ${latestRun ? `${latestRun.started_at} (${latestRun.status})` : 'No runs recorded'}
  Next window:    ${config.schedule.windowStart} (${config.schedule.timezone}, window: ${config.schedule.windowMinutes}m)
  Days remaining: ${daysRemaining}
\n`);
  }

  // Return code 1 if streak is at risk (e.g. yesterday failed or today is in error)
  if (latestRun && latestRun.status === 'failed') {
    return 1;
  }
  return 0;
}

async function handleAuthLogin(cliArgs: CliArgs): Promise<number> {
  const config = loadConfig(cliArgs.configPath);
  ensureDirectories(config);

  const remoteUrl = process.env.TAILSCALE_IP
    ? `http://${process.env.TAILSCALE_IP}:6080/`
    : 'http://localhost:6080/';

  process.stdout.write(
    `[AUTH] Launching interactive headed browser for AWS Builder Center login...\n` +
      `[AUTH] Please complete login, MFA, and select 'Remember this device'.\n` +
      `[AUTH] Access web interface at: ${remoteUrl}\n`
  );

  const { context, page } = await launchAuthenticatedContext(config, true);

  try {
    await page.goto('https://builder.aws.com', { waitUntil: 'domcontentloaded' });

    const maxWaitMs = 10 * 60 * 1000; // 10 minutes
    const pollIntervalMs = 2000;
    const start = Date.now();

    let authenticated = false;
    let pollCount = 0;
    while (Date.now() - start < maxWaitMs) {
      await page.waitForTimeout(pollIntervalMs);
      pollCount++;

      // Check all open pages in context (handles redirects/popups)
      const pages = context.pages();
      for (const p of pages) {
        authenticated = await verifyAuthentication(p, false);
        if (authenticated) break;
      }

      if (pollCount % 5 === 0 && !authenticated) {
        process.stdout.write(`[AUTH] Still waiting for sign-in completion at ${remoteUrl} ...\n`);
      }

      if (authenticated) {
        process.stdout.write(`\n[AUTH SUCCESS] Authentication verified and device recognized!\n`);
        await persistSession(context, config.browser.profileDir);
        process.stdout.write(`[AUTH SUCCESS] Session saved to ${config.browser.profileDir}/storage_state.json.\n`);
        await context.close();
        return 0;
      }
    }

    process.stderr.write(`\n[AUTH TIMEOUT] Interactive login timed out after 10 minutes.\n`);
    await context.close();
    return 1;
  } catch (err: any) {
    process.stderr.write(`\n[AUTH ERROR] Failed during login: ${err.message}\n`);
    await context.close();
    return 1;
  }
}

async function handleHistory(cliArgs: CliArgs): Promise<number> {
  const config = loadConfig(cliArgs.configPath);
  const db = initDb(config.database.path);

  const interactions = getRecentInteractions(db, cliArgs.days, cliArgs.action);
  const totalLikes = getInteractionCount(db, 'like');
  const totalComments = getInteractionCount(db, 'comment');

  if (cliArgs.json) {
    process.stdout.write(
      `${JSON.stringify({ interactions, totals: { likes: totalLikes, comments: totalComments } }, null, 2)}\n`
    );
    return 0;
  }

  process.stdout.write(`
AWS Badge Streak Agent — Interaction History (Last ${cliArgs.days} days)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`);

  if (interactions.length === 0) {
    process.stdout.write(`  No interactions recorded yet.\n\n`);
  } else {
    for (const item of interactions) {
      const actionIcon = item.action_type === 'like' ? '👍 LIKE   ' : '💬 COMMENT';
      const title = (item.post_title || 'Untitled').slice(0, 48).padEnd(48);
      process.stdout.write(`  [${item.created_at.slice(0, 19)}] ${actionIcon} | ${title} | ${item.post_id}\n`);
      if (item.comment_text) {
        process.stdout.write(`    ↳ "${item.comment_text}"\n`);
      }
    }
  }

  process.stdout.write(`
  Totals: ${totalLikes} likes, ${totalComments} comments.
\n`);

  return 0;
}

async function handleScheduler(cliArgs: CliArgs): Promise<number> {
  const config = loadConfig(cliArgs.configPath);
  ensureDirectories(config);

  if (!acquireSchedulerLock()) {
    process.stderr.write(`[ERROR] Scheduler daemon is already running (data/.scheduler.lock present).\n`);
    return 1;
  }

  process.stdout.write(`[SCHEDULER] Daily streak scheduler started in ${config.schedule.timezone}.\n`);
  startScheduler(config);

  return new Promise(() => {}); // Keep alive
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cliArgs = parseArgs(args);

  let exitCode = 0;
  switch (cliArgs.command) {
    case 'run':
      exitCode = await handleRun(cliArgs);
      break;
    case 'status':
      exitCode = await handleStatus(cliArgs);
      break;
    case 'auth:login':
      exitCode = await handleAuthLogin(cliArgs);
      break;
    case 'history':
      exitCode = await handleHistory(cliArgs);
      break;
    case 'scheduler:start':
      exitCode = await handleScheduler(cliArgs);
      break;
    default:
      process.stderr.write(`Unknown command: "${cliArgs.command}".\n`);
      process.stderr.write(`Available commands: run, status, auth:login, history, scheduler:start\n`);
      exitCode = 1;
      break;
  }

  process.exit(exitCode);
}

main().catch((err) => {
  process.stderr.write(`[FATAL] Uncaught exception: ${err.message}\n${err.stack}\n`);
  process.exit(2);
});
