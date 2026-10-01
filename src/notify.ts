import type { Config, ExecutionReport } from './types.js';

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function formatTelegramReport(report: ExecutionReport): string {
  const statusIcon =
    report.status === 'completed' ? '✅' : report.status === 'partial' ? '⚠️' : '🚨';
  const statusTitle = report.status.toUpperCase();

  const stepLines = report.steps
    .map((s) => {
      const icon = s.status === 'completed' ? '✅' : s.status === 'failed' ? '❌' : '⚪';
      const dur = (s.durationMs / 1000).toFixed(1);
      return `${icon} <b>${s.name}</b> (${dur}s)${s.errorMessage ? ` - <i>${escapeHtml(s.errorMessage)}</i>` : ''}`;
    })
    .join('\n');

  let text =
    `${statusIcon} <b>AWS Streak Agent: ${statusTitle}</b>\n\n` +
    `<b>Run ID:</b> <code>${escapeHtml(report.runId)}</code>\n` +
    `<b>Duration:</b> ${(report.durationMs / 1000).toFixed(1)}s\n` +
    `<b>Streak Progress (Goal: ${report.streaks.target}d):</b>\n` +
    `  • Visit: <b>${report.streaks.visit}</b> / ${report.streaks.target} 🔥\n` +
    `  • Like: <b>${report.streaks.like}</b> / ${report.streaks.target} 🔥\n` +
    `  • Comment: <b>${report.streaks.comment}</b> / ${report.streaks.target} 🔥\n\n` +
    `<b>Step Breakdown:</b>\n${stepLines}`;

  if (report.errorMessage) {
    text += `\n\n<b>Diagnostic:</b>\n<code>${escapeHtml(report.errorMessage)}</code>`;
  }

  return text;
}

export function formatDiscordEmbed(report: ExecutionReport): Record<string, unknown> {
  const colors = {
    completed: 0x2ecc71, // Green
    partial: 0xf1c40f, // Amber
    failed: 0xed4245, // Red
    running: 0x3498db, // Blue
  };

  const stepSummary = report.steps
    .map((s) => {
      const icon = s.status === 'completed' ? '✅' : s.status === 'failed' ? '❌' : '⚪';
      return `${icon} **${s.name}** (\`${(s.durationMs / 1000).toFixed(1)}s\`)${
        s.errorMessage ? `\n> ⚠️ *${s.errorMessage}*` : ''
      }`;
    })
    .join('\n');

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: 'Run ID', value: `\`${report.runId}\``, inline: true },
    { name: 'Status', value: `**${report.status.toUpperCase()}**`, inline: true },
    { name: 'Duration', value: `${(report.durationMs / 1000).toFixed(1)}s`, inline: true },
    {
      name: `Streaks Progress (Target: ${report.streaks.target} Days)`,
      value:
        `🌐 **Visit:** \`${report.streaks.visit}/${report.streaks.target}\`\n` +
        `👍 **Like:** \`${report.streaks.like}/${report.streaks.target}\`\n` +
        `💬 **Comment:** \`${report.streaks.comment}/${report.streaks.target}\``,
      inline: false,
    },
    { name: 'Execution Steps', value: stepSummary || 'None', inline: false },
  ];

  if (report.errorMessage) {
    fields.push({
      name: 'Failure Diagnostic',
      value: `\`\`\`text\n${report.errorMessage.slice(0, 950)}\n\`\`\``,
      inline: false,
    });
  }

  return {
    title:
      report.status === 'completed'
        ? '✅ Daily Streak Completed'
        : report.status === 'partial'
          ? '⚠️ Daily Streak Partially Completed'
          : '🚨 Streak Execution Alert',
    color: colors[report.status],
    fields,
    timestamp: report.startedAt,
    ...(report.screenshotBuffer ? { image: { url: 'attachment://screenshot.png' } } : {}),
    footer: { text: 'AWS Builder Center Streak Agent' },
  };
}

export async function sendTelegramNotification(
  token: string,
  chatId: string,
  report: ExecutionReport,
  screenshotBuffer?: Buffer
): Promise<void> {
  const fullHtml = formatTelegramReport(report);

  if (screenshotBuffer) {
    const formData = new FormData();
    formData.append('chat_id', chatId);
    // Telegram caption is limited to 1024 characters
    formData.append('caption', fullHtml.slice(0, 1024));
    formData.append('parse_mode', 'HTML');

    const blob = new Blob([new Uint8Array(screenshotBuffer)], { type: 'image/png' });
    formData.append('photo', blob, 'screenshot.png');

    const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      throw new Error(`Telegram sendPhoto failed: ${res.status} ${await res.text()}`);
    }

    // If report text was truncated, follow up with text message for full diagnostics
    if (fullHtml.length > 1024) {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: fullHtml,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });
    }
  } else {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: fullHtml,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });

    if (!res.ok) {
      throw new Error(`Telegram sendMessage failed: ${res.status} ${await res.text()}`);
    }
  }
}

export async function sendDiscordNotification(
  webhookUrl: string,
  report: ExecutionReport,
  screenshotBuffer?: Buffer
): Promise<void> {
  const embed = formatDiscordEmbed(report);

  if (screenshotBuffer) {
    const formData = new FormData();
    formData.append(
      'payload_json',
      JSON.stringify({
        username: 'AWS Streak Agent',
        avatar_url: 'https://a0.awsstatic.com/libra-css/images/site/fav/favicon.ico',
        embeds: [embed],
      })
    );

    const blob = new Blob([new Uint8Array(screenshotBuffer)], { type: 'image/png' });
    formData.append('files[0]', blob, 'screenshot.png');

    const res = await fetch(webhookUrl, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      throw new Error(`Discord webhook upload failed: ${res.status} ${await res.text()}`);
    }
  } else {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'AWS Streak Agent',
        avatar_url: 'https://a0.awsstatic.com/libra-css/images/site/fav/favicon.ico',
        embeds: [embed],
      }),
    });

    if (!res.ok) {
      throw new Error(`Discord webhook message failed: ${res.status} ${await res.text()}`);
    }
  }
}

export async function sendNotification(
  config: Config,
  report: ExecutionReport,
  screenshotBuffer?: Buffer
): Promise<void> {
  const tasks: Promise<void>[] = [];

  const tgToken = config.notifications.telegram.botToken;
  const tgChatId = config.notifications.telegram.chatId;
  const tgEnabled = config.notifications.telegram.enabled;

  if (tgEnabled && tgToken && tgChatId) {
    tasks.push(
      sendTelegramNotification(tgToken, tgChatId, report, screenshotBuffer)
        .then(() => {
          process.stdout.write(
            `[NOTIFY] Telegram notification successfully dispatched to chat ${tgChatId}.\n`
          );
        })
        .catch((err) => {
          process.stderr.write(`[WARN] Failed to dispatch Telegram alert: ${err.message}\n`);
        })
    );
  } else if (tgToken || tgChatId) {
    process.stderr.write(
      `[NOTIFY INFO] Telegram notification skipped: enabled=${tgEnabled}, ` +
        `hasToken=${Boolean(tgToken)}, hasChatId=${Boolean(tgChatId)}\n`
    );
  }

  const dcUrl = config.notifications.discord.webhookUrl;
  const dcEnabled = config.notifications.discord.enabled;

  if (dcEnabled && dcUrl) {
    tasks.push(
      sendDiscordNotification(dcUrl, report, screenshotBuffer)
        .then(() => {
          process.stdout.write(`[NOTIFY] Discord notification successfully dispatched.\n`);
        })
        .catch((err) => {
          process.stderr.write(`[WARN] Failed to dispatch Discord alert: ${err.message}\n`);
        })
    );
  }

  await Promise.all(tasks);
}
