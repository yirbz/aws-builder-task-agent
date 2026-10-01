import { describe, it, expect } from 'vitest';
import { validateConfig, applyEnvOverrides, DEFAULT_CONFIG, loadConfig } from '../../src/config.js';
import type { Config } from '../../src/types.js';

describe('Configuration Module', () => {
  it('should validate a correct default configuration', () => {
    expect(() => validateConfig(DEFAULT_CONFIG)).not.toThrow();
  });

  it('should reject windowMinutes < 45', () => {
    const invalid: Config = {
      ...DEFAULT_CONFIG,
      schedule: {
        ...DEFAULT_CONFIG.schedule,
        windowMinutes: 30,
      },
    };
    expect(() => validateConfig(invalid)).toThrow(/windowMinutes.*>= 45/);
  });

  it('should reject invalid windowStart format', () => {
    const invalid: Config = {
      ...DEFAULT_CONFIG,
      schedule: {
        ...DEFAULT_CONFIG.schedule,
        windowStart: '25:70',
      },
    };
    expect(() => validateConfig(invalid)).toThrow(/windowStart/);
  });

  it('should reject invalid timezone', () => {
    const invalid: Config = {
      ...DEFAULT_CONFIG,
      schedule: {
        ...DEFAULT_CONFIG.schedule,
        timezone: 'Mars/Phobos',
      },
    };
    expect(() => validateConfig(invalid)).toThrow(/timezone/);
  });

  it('should apply environment variable overrides', () => {
    process.env.STREAK_SCHEDULE__WINDOW_START = '11:15';
    process.env.STREAK_SCHEDULE__WINDOW_MINUTES = '60';
    process.env.STREAK_COMMENTS__PROVIDER = 'ollama';

    const overridden = applyEnvOverrides(DEFAULT_CONFIG);

    expect(overridden.schedule.windowStart).toBe('11:15');
    expect(overridden.schedule.windowMinutes).toBe(60);
    expect(overridden.comments.provider).toBe('ollama');

    delete process.env.STREAK_SCHEDULE__WINDOW_START;
    delete process.env.STREAK_SCHEDULE__WINDOW_MINUTES;
    delete process.env.STREAK_COMMENTS__PROVIDER;
  });

  it('should override gemini model from STREAK_COMMENTS__GEMINI_MODEL or GEMINI_MODEL', () => {
    process.env.STREAK_COMMENTS__GEMINI_MODEL = 'gemini-2.5-flash';
    let overridden = applyEnvOverrides(DEFAULT_CONFIG);
    expect(overridden.comments.geminiModel).toBe('gemini-2.5-flash');
    delete process.env.STREAK_COMMENTS__GEMINI_MODEL;

    process.env.GEMINI_MODEL = 'gemini-1.5-pro';
    overridden = applyEnvOverrides(DEFAULT_CONFIG);
    expect(overridden.comments.geminiModel).toBe('gemini-1.5-pro');
    delete process.env.GEMINI_MODEL;
  });

  it('should gracefully handle configPath being a directory without throwing EISDIR', () => {
    // Pass an existing directory, e.g. ./tests
    const config = loadConfig('./tests');
    expect(config).toBeDefined();
    expect(config.schedule.windowStart).toBe('10:45');
  });
});
