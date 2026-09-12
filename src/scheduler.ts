import fs from 'node:fs';
import path from 'node:path';
import type { Config } from './types.js';
import { initDb } from './db.js';
import { runDailyStreak } from './streak-runner.js';
import { randomWindowDelay } from './human-behavior.js';

export function calculateNextExecution(config: Config): {
  targetDate: Date;
  jitterMs: number;
  totalWaitMs: number;
} {
  const [targetHour, targetMinute] = config.schedule.windowStart
    .split(':')
    .map((s) => Number.parseInt(s, 10));

  // Determine current time in the configured timezone
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: config.schedule.timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const getPart = (type: string) =>
    Number.parseInt(parts.find((p) => p.type === type)?.value || '0', 10);

  const curHour = getPart('hour');
  const curMinute = getPart('minute');

  let daysToAdd = 0;
  if (curHour > targetHour || (curHour === targetHour && curMinute >= targetMinute)) {
    daysToAdd = 1;
  }

  // Jitter between 0 and windowMinutes (min 45 mins)
  const jitterMs = randomWindowDelay(config.schedule.windowMinutes);

  // Compute time difference
  const targetDate = new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
  // Re-adjust hour & minute
  const baseWaitMs =
    (daysToAdd * 24 + (targetHour - curHour)) * 60 * 60 * 1000 +
    (targetMinute - curMinute) * 60 * 1000 -
    getPart('second') * 1000;

  const totalWaitMs = Math.max(1000, baseWaitMs + jitterMs);

  return {
    targetDate: new Date(now.getTime() + totalWaitMs),
    jitterMs,
    totalWaitMs,
  };
}

export function startScheduler(config: Config): void {
  const db = initDb(config.database.path);

  const scheduleNext = () => {
    const { targetDate, jitterMs, totalWaitMs } = calculateNextExecution(config);
    const jitterMins = (jitterMs / 60000).toFixed(1);
    const waitHours = (totalWaitMs / 3600000).toFixed(2);

    process.stdout.write(
      `[SCHEDULER] Next daily streak execution scheduled for ${targetDate.toISOString()} (in ${waitHours}h, includes ${jitterMins}m jitter)\n`
    );

    setTimeout(async () => {
      process.stdout.write(`[SCHEDULER] Executing scheduled daily streak...\n`);
      try {
        await runDailyStreak(config, db);
      } catch (err: any) {
        process.stderr.write(`[SCHEDULER ERROR] Daily run encountered error: ${err.message}\n`);
      }

      // Schedule next run
      scheduleNext();
    }, totalWaitMs);
  };

  scheduleNext();
}

export function acquireSchedulerLock(): boolean {
  const lockFile = path.resolve('./data/.scheduler.lock');
  if (fs.existsSync(lockFile)) {
    try {
      const pidStr = fs.readFileSync(lockFile, 'utf-8').trim();
      const pid = Number.parseInt(pidStr, 10);
      // Check if process is still alive
      process.kill(pid, 0);
      return false; // Process exists and is running
    } catch {
      // Process does not exist, lock is stale
    }
  }

  fs.writeFileSync(lockFile, String(process.pid));

  const cleanup = () => {
    try {
      if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);
    } catch {}
  };

  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });

  return true;
}
