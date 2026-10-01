import fs from 'node:fs';
import path from 'node:path';
import type { Config } from './types.js';

export const DEFAULT_CONFIG: Config = {
  schedule: {
    windowStart: '10:45',
    windowMinutes: 45,
    timezone: 'America/New_York',
  },
  browser: {
    profileDir: './data/browser-profile',
    screenshotOnFailure: true,
  },
  comments: {
    provider: 'gemini',
    geminiApiKey: '',
    geminiModel: 'gemini-2.0-flash',
    ollamaBaseUrl: 'http://localhost:11434',
    ollamaModel: 'llama3.2:3b',
    timeoutMs: 8000,
  },
  notifications: {
    telegram: {
      enabled: false,
      botToken: '',
      chatId: '',
    },
    discord: {
      enabled: false,
      webhookUrl: '',
    },
  },
  database: {
    path: './data/streak-agent.db',
  },
  retry: {
    maxAttempts: 3,
    baseDelayMs: 2000,
    maxDelayMs: 30000,
  },
};

function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const output = { ...target };
  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceValue = source[key];
    const targetValue = target[key];
    if (
      sourceValue &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      targetValue &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue)
    ) {
      output[key] = deepMerge(targetValue, sourceValue);
    } else if (sourceValue !== undefined) {
      output[key] = sourceValue as any;
    }
  }
  return output;
}

export function validateConfig(config: Config): void {
  const errors: string[] = [];

  // Validate windowStart
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(config.schedule.windowStart)) {
    errors.push(
      `Invalid schedule.windowStart: "${config.schedule.windowStart}". Must be 24-hour HH:MM format (e.g. "10:45").`
    );
  }

  // Validate windowMinutes
  if (typeof config.schedule.windowMinutes !== 'number' || config.schedule.windowMinutes < 45) {
    errors.push(
      `Invalid schedule.windowMinutes: ${config.schedule.windowMinutes}. Must be a number >= 45 to allow sufficient timing jitter.`
    );
  }

  // Validate timezone
  try {
    Intl.DateTimeFormat(undefined, { timeZone: config.schedule.timezone });
  } catch {
    errors.push(
      `Invalid schedule.timezone: "${config.schedule.timezone}". Must be a valid IANA timezone (e.g. "America/New_York", "UTC").`
    );
  }

  // Validate Telegram config
  if (config.notifications.telegram.enabled) {
    if (!config.notifications.telegram.botToken) {
      errors.push('Telegram is enabled but notifications.telegram.botToken is missing.');
    } else if (!/^\d+:[A-Za-z0-9_-]+$/.test(config.notifications.telegram.botToken)) {
      errors.push(
        'notifications.telegram.botToken does not match expected format: {numeric_id}:{token}.'
      );
    }
    if (!config.notifications.telegram.chatId) {
      errors.push('Telegram is enabled but notifications.telegram.chatId is missing.');
    }
  }

  // Validate Discord config
  if (config.notifications.discord.enabled) {
    if (!config.notifications.discord.webhookUrl) {
      errors.push('Discord is enabled but notifications.discord.webhookUrl is missing.');
    } else if (!config.notifications.discord.webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
      errors.push(
        'notifications.discord.webhookUrl must start with "https://discord.com/api/webhooks/".'
      );
    }
  }

  if (errors.length > 0) {
    const message = `Configuration validation failed:\n  • ${errors.join('\n  • ')}`;
    throw new Error(message);
  }
}

export function applyEnvOverrides(config: Config): Config {
  const env = process.env;
  const cfg = JSON.parse(JSON.stringify(config)) as Config;

  if (env.STREAK_SCHEDULE__WINDOW_START) {
    cfg.schedule.windowStart = env.STREAK_SCHEDULE__WINDOW_START;
  }
  if (env.STREAK_SCHEDULE__WINDOW_MINUTES) {
    cfg.schedule.windowMinutes = Number.parseInt(env.STREAK_SCHEDULE__WINDOW_MINUTES, 10);
  }
  if (env.STREAK_SCHEDULE__TIMEZONE) {
    cfg.schedule.timezone = env.STREAK_SCHEDULE__TIMEZONE;
  }

  if (env.STREAK_BROWSER__PROFILE_DIR) {
    cfg.browser.profileDir = env.STREAK_BROWSER__PROFILE_DIR;
  }
  if (env.STREAK_BROWSER__SCREENSHOT_ON_FAILURE !== undefined) {
    cfg.browser.screenshotOnFailure = env.STREAK_BROWSER__SCREENSHOT_ON_FAILURE === 'true';
  }

  if (env.STREAK_COMMENTS__PROVIDER) {
    cfg.comments.provider = env.STREAK_COMMENTS__PROVIDER as any;
  }
  if (env.STREAK_COMMENTS__GEMINI_API_KEY || env.GEMINI_API_KEY) {
    cfg.comments.geminiApiKey = env.STREAK_COMMENTS__GEMINI_API_KEY || env.GEMINI_API_KEY || '';
  }
  if (env.STREAK_COMMENTS__GEMINI_MODEL || env.GEMINI_MODEL) {
    cfg.comments.geminiModel = env.STREAK_COMMENTS__GEMINI_MODEL || env.GEMINI_MODEL || '';
  }
  if (env.STREAK_COMMENTS__OLLAMA_BASE_URL) {
    cfg.comments.ollamaBaseUrl = env.STREAK_COMMENTS__OLLAMA_BASE_URL;
  }
  if (env.STREAK_COMMENTS__OLLAMA_MODEL) {
    cfg.comments.ollamaModel = env.STREAK_COMMENTS__OLLAMA_MODEL;
  }
  if (env.STREAK_COMMENTS__TIMEOUT_MS) {
    cfg.comments.timeoutMs = Number.parseInt(env.STREAK_COMMENTS__TIMEOUT_MS, 10);
  }

  if (env.STREAK_NOTIFICATIONS__TELEGRAM__BOT_TOKEN || env.TELEGRAM_BOT_TOKEN) {
    cfg.notifications.telegram.botToken =
      env.STREAK_NOTIFICATIONS__TELEGRAM__BOT_TOKEN || env.TELEGRAM_BOT_TOKEN || '';
  }
  if (env.STREAK_NOTIFICATIONS__TELEGRAM__CHAT_ID || env.TELEGRAM_CHAT_ID) {
    cfg.notifications.telegram.chatId =
      env.STREAK_NOTIFICATIONS__TELEGRAM__CHAT_ID || env.TELEGRAM_CHAT_ID || '';
  }
  if (env.STREAK_NOTIFICATIONS__TELEGRAM__ENABLED !== undefined || env.TELEGRAM_ENABLED !== undefined) {
    const val = env.STREAK_NOTIFICATIONS__TELEGRAM__ENABLED ?? env.TELEGRAM_ENABLED;
    cfg.notifications.telegram.enabled = val === 'true';
  } else if (cfg.notifications.telegram.botToken && cfg.notifications.telegram.chatId) {
    // Automatically enable Telegram if both bot token and chatId are provided
    cfg.notifications.telegram.enabled = true;
  }

  if (env.STREAK_NOTIFICATIONS__DISCORD__WEBHOOK_URL || env.DISCORD_WEBHOOK_URL) {
    cfg.notifications.discord.webhookUrl =
      env.STREAK_NOTIFICATIONS__DISCORD__WEBHOOK_URL || env.DISCORD_WEBHOOK_URL || '';
  }
  if (env.STREAK_NOTIFICATIONS__DISCORD__ENABLED !== undefined || env.DISCORD_ENABLED !== undefined) {
    const val = env.STREAK_NOTIFICATIONS__DISCORD__ENABLED ?? env.DISCORD_ENABLED;
    cfg.notifications.discord.enabled = val === 'true';
  } else if (cfg.notifications.discord.webhookUrl) {
    // Automatically enable Discord if webhookUrl is provided
    cfg.notifications.discord.enabled = true;
  }

  if (env.STREAK_DATABASE__PATH) {
    cfg.database.path = env.STREAK_DATABASE__PATH;
  }

  if (env.STREAK_RETRY__MAX_ATTEMPTS) {
    cfg.retry.maxAttempts = Number.parseInt(env.STREAK_RETRY__MAX_ATTEMPTS, 10);
  }
  if (env.STREAK_RETRY__BASE_DELAY_MS) {
    cfg.retry.baseDelayMs = Number.parseInt(env.STREAK_RETRY__BASE_DELAY_MS, 10);
  }
  if (env.STREAK_RETRY__MAX_DELAY_MS) {
    cfg.retry.maxDelayMs = Number.parseInt(env.STREAK_RETRY__MAX_DELAY_MS, 10);
  }

  return cfg;
}

export function loadConfig(configPath?: string): Config {
  const resolvedPath = path.resolve(configPath || './config.json');
  let fileConfig: Partial<Config> = {};

  if (fs.existsSync(resolvedPath)) {
    try {
      const stat = fs.statSync(resolvedPath);
      if (stat.isDirectory()) {
        const nestedConfig = path.join(resolvedPath, 'config.json');
        if (fs.existsSync(nestedConfig) && fs.statSync(nestedConfig).isFile()) {
          const raw = fs.readFileSync(nestedConfig, 'utf-8');
          fileConfig = JSON.parse(raw);
        } else {
          process.stderr.write(
            `[CONFIG WARNING] "${resolvedPath}" is a directory, not a file.\n` +
              `This usually happens when Docker auto-creates "./config.json" as a directory because it was missing on the host.\n` +
              `To fix on host: "rm -rf config.json && cp config.example.json config.json"\n` +
              `Falling back to default / example configuration.\n`
          );
          const examplePath = path.resolve(path.dirname(resolvedPath), 'config.example.json');
          if (fs.existsSync(examplePath) && fs.statSync(examplePath).isFile()) {
            const raw = fs.readFileSync(examplePath, 'utf-8');
            fileConfig = JSON.parse(raw);
          }
        }
      } else {
        const raw = fs.readFileSync(resolvedPath, 'utf-8');
        fileConfig = JSON.parse(raw);
      }
    } catch (err: any) {
      throw new Error(`Failed to parse configuration file at "${resolvedPath}": ${err.message}`);
    }
  }

  const merged = deepMerge(DEFAULT_CONFIG, fileConfig);
  const finalConfig = applyEnvOverrides(merged);
  validateConfig(finalConfig);
  return finalConfig;
}

export function ensureDirectories(config: Config): void {
  const dirs = [
    path.resolve(config.browser.profileDir),
    path.resolve(path.dirname(config.database.path)),
    path.resolve('./data/screenshots'),
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}
