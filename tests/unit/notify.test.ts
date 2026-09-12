import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  formatTelegramReport,
  formatDiscordEmbed,
} from '../../src/notify.js';
import type { ExecutionReport } from '../../src/types.js';

describe('Notification Formatter', () => {
  const sampleReport: ExecutionReport = {
    runId: 'test-run-uuid-123',
    status: 'completed',
    startedAt: '2026-09-11T10:45:00Z',
    completedAt: '2026-09-11T10:45:31Z',
    durationMs: 31500,
    steps: [
      { name: 'authenticate', status: 'completed', durationMs: 1200, retryCount: 0 },
      { name: 'visit', status: 'completed', durationMs: 3500, retryCount: 0 },
      { name: 'like', status: 'completed', durationMs: 8200, retryCount: 0 },
      { name: 'comment', status: 'completed', durationMs: 14200, retryCount: 0 },
      { name: 'verify', status: 'completed', durationMs: 4400, retryCount: 0 },
    ],
    streaks: {
      visit: 42,
      like: 42,
      comment: 42,
      target: 90,
    },
  };

  it('should escape HTML reserved characters', () => {
    const raw = '<script>alert("test & verify > all")</script>';
    const escaped = escapeHtml(raw);
    expect(escaped).toBe('&lt;script&gt;alert("test &amp; verify &gt; all")&lt;/script&gt;');
  });

  it('should format Telegram HTML report with streak counts and step breakdown', () => {
    const html = formatTelegramReport(sampleReport);
    expect(html).toContain('AWS Streak Agent: COMPLETED');
    expect(html).toContain('42</b> / 90 🔥');
    expect(html).toContain('test-run-uuid-123');
    expect(html).toContain('authenticate</b> (1.2s)');
    expect(html).toContain('comment</b> (14.2s)');
  });

  it('should format Discord embed object with color and fields', () => {
    const embed = formatDiscordEmbed(sampleReport) as any;
    expect(embed.title).toContain('Daily Streak Completed');
    expect(embed.color).toBe(0x2ecc71); // Green for completed
    expect(embed.fields).toBeDefined();

    const runIdField = embed.fields.find((f: any) => f.name === 'Run ID');
    expect(runIdField?.value).toContain('test-run-uuid-123');

    const streakField = embed.fields.find((f: any) => f.name.includes('Streaks Progress'));
    expect(streakField?.value).toContain('42/90');
  });

  it('should use red color for failed reports in Discord embed', () => {
    const failedReport: ExecutionReport = {
      ...sampleReport,
      status: 'failed',
      errorMessage: 'Authentication session expired',
    };
    const embed = formatDiscordEmbed(failedReport) as any;
    expect(embed.color).toBe(0xed4245); // Red for failed
    expect(embed.title).toContain('Streak Execution Alert');
  });
});
