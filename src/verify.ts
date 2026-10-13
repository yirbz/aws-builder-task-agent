import type { Page } from 'rebrowser-playwright';
import type { StepResult } from './types.js';
import type { EventEmitter } from './events.js';

export interface StreaksResult {
  visit: number;
  like: number;
  comment: number;
}

export interface VerifyOutput {
  result: StepResult;
  streaks: StreaksResult;
}

export async function fetchBadgeProgress(
  page: Page
): Promise<{ streaks: StreaksResult; verifiedVia: string }> {
  let visitStreak = 0;
  let likeStreak = 0;
  let commentStreak = 0;
  let verifiedVia = 'none';

  // Tier 1: Try the badges API (in-browser evaluate with full cookie context)
  const cookies = await page.context().cookies(['https://builder.aws.com', 'https://api.builder.aws.com']);
  const sessionCookie = cookies.find((c) => c.name === 'builder-session-token')?.value;

  let apiResult: any = null;
  try {
    apiResult = (await page.evaluate(async (tokenFromCookie) => {
      const sessionToken = localStorage.getItem('builder-session-token') || tokenFromCookie;
      const builderId = localStorage.getItem('builder-id');
      const profileId = localStorage.getItem('builder-profile-id');
      const bpToken = localStorage.getItem('builder-bp-token');

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
      if (sessionToken) headers['builder-session-token'] = sessionToken;
      if (builderId) headers['builder-id'] = builderId;
      if (profileId) headers['builder-profile-id'] = profileId;
      if (bpToken) headers['builder-bp-token'] = bpToken;

      const res = await fetch('https://api.builder.aws.com/rms/badges/progress', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({ locale: 'en', pageSize: 50 }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }

      return await res.json();
    }, sessionCookie)) as any;
    verifiedVia = 'api-browser';
  } catch (browserEvalErr: any) {
    // Tier 2: Try from Node.js with extracted cookies
    if (sessionCookie) {
      try {
        const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
        const res = await fetch('https://api.builder.aws.com/rms/badges/progress', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'builder-session-token': sessionCookie,
            Cookie: cookieHeader,
          },
          body: JSON.stringify({ locale: 'en', pageSize: 50 }),
        });
        if (res.ok) {
          apiResult = await res.json();
          verifiedVia = 'api-node';
        }
      } catch {
        // Continue to DOM fallback
      }
    }

    // Tier 3: DOM-based fallback — navigate to badges page and scrape streak values
    if (!apiResult) {
      try {
        await page.goto('https://builder.aws.com/badges', {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        });
        await page.waitForTimeout(2000);

        const domStreaks = await page.evaluate(() => {
          const text = document.body.innerText || '';
          const streaks: Record<string, number> = { visit: 0, like: 0, comment: 0 };

          const patterns = [
            { key: 'visit', regex: /visit(?:or)?\s*(?:streak)?[:\s]*(\d+)/i },
            { key: 'like', regex: /(?:like|reaction)\s*(?:streak)?[:\s]*(\d+)/i },
            { key: 'comment', regex: /(?:comment|discussion)\s*(?:streak)?[:\s]*(\d+)/i },
          ];

          for (const { key, regex } of patterns) {
            const match = text.match(regex);
            if (match) {
              streaks[key] = parseInt(match[1], 10);
            }
          }

          const progressElements = document.querySelectorAll(
            '[class*="progress"], [class*="streak"], [data-testid*="streak"], [data-testid*="badge"]'
          );
          for (const el of progressElements) {
            const elText = (el as HTMLElement).innerText || '';
            for (const { key, regex } of patterns) {
              const match = elText.match(regex);
              if (match && parseInt(match[1], 10) > streaks[key]) {
                streaks[key] = parseInt(match[1], 10);
              }
            }
          }

          return streaks;
        });

        if (domStreaks.visit > 0 || domStreaks.like > 0 || domStreaks.comment > 0) {
          visitStreak = domStreaks.visit;
          likeStreak = domStreaks.like;
          commentStreak = domStreaks.comment;
          verifiedVia = 'dom-scrape';
        }
      } catch (domErr: any) {
        process.stderr.write(`[VERIFY] DOM scraping also failed: ${domErr.message}\n`);
      }
    }
  }

  // Parse API result if we got one
  if (apiResult) {
    const badgeList: any[] = apiResult?.badgeProgressList || [];

    for (const item of badgeList) {
      const badgeId: string = (item.baseBadge?.badgeId || '').toLowerCase();
      const progress: number = item.progressCount ?? 0;

      if (badgeId.includes('visitor') || badgeId.includes('visit')) {
        visitStreak = Math.max(visitStreak, progress);
      } else if (badgeId.includes('like') || badgeId.includes('reaction') || badgeId.includes('upvote')) {
        likeStreak = Math.max(likeStreak, progress);
      } else if (badgeId.includes('comment') || badgeId.includes('discussion') || badgeId.includes('reply')) {
        commentStreak = Math.max(commentStreak, progress);
      }
    }
  }

  return {
    streaks: { visit: visitStreak, like: likeStreak, comment: commentStreak },
    verifiedVia,
  };
}

export async function executeVerify(
  page: Page,
  emitter: EventEmitter
): Promise<VerifyOutput> {
  const startTime = Date.now();
  emitter.stepStarted('verify');

  try {
    const { streaks, verifiedVia } = await fetchBadgeProgress(page);
    const durationMs = Date.now() - startTime;

    if (verifiedVia !== 'none') {
      emitter.stepCompleted('verify', durationMs, {
        visit: streaks.visit,
        like: streaks.like,
        comment: streaks.comment,
        verifiedVia,
      });

      return {
        result: {
          name: 'verify',
          status: 'completed',
          durationMs,
          retryCount: 0,
          resultData: { visit: streaks.visit, like: streaks.like, comment: streaks.comment, verifiedVia },
        },
        streaks,
      };
    }

    process.stderr.write(
      `[VERIFY] ⚠️ All verification methods failed. Streak counts could not be confirmed.\n`
    );
    emitter.stepCompleted('verify', durationMs, {
      visit: 0,
      like: 0,
      comment: 0,
      verifiedVia: 'none',
      warning: 'All verification methods failed. Streak counts unconfirmed.',
    });

    return {
      result: {
        name: 'verify',
        status: 'completed',
        durationMs,
        retryCount: 0,
        resultData: {
          visit: 0,
          like: 0,
          comment: 0,
          verifiedVia: 'none',
          warning: 'All verification methods failed. Streak counts unconfirmed.',
        },
      },
      streaks: { visit: 0, like: 0, comment: 0 },
    };
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    process.stderr.write(`[WARN] Badge progress verification failed: ${err.message}\n`);
    emitter.stepFailed('verify', durationMs, 'retryable', err.message, 0);

    return {
      result: {
        name: 'verify',
        status: 'failed',
        durationMs,
        retryCount: 0,
        errorType: 'retryable',
        errorMessage: err.message,
      },
      streaks: { visit: -1, like: -1, comment: -1 },
    };
  }
}
