import { describe, it, expect } from 'vitest';
import { validateConfig, applyEnvOverrides, DEFAULT_CONFIG } from '../../src/config.js';
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
});
