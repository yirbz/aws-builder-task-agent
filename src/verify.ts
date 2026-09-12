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

export async function executeVerify(
  page: Page,
  emitter: EventEmitter
): Promise<VerifyOutput> {
  const startTime = Date.now();
  emitter.stepStarted('verify');

  try {
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
    } catch (browserEvalErr: any) {
      if (sessionCookie) {
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
        } else {
          throw browserEvalErr;
        }
      } else {
        throw browserEvalErr;
      }
    }

    const badgeList: any[] = apiResult?.badgeProgressList || [];

    let visitStreak = 0;
    let likeStreak = 0;
    let commentStreak = 0;

    for (const item of badgeList) {
      const badgeId: string = item.baseBadge?.badgeId || '';
      const progress: number = item.progressCount ?? 0;

      if (badgeId.includes('visitor.streak')) {
        visitStreak = Math.max(visitStreak, progress);
      } else if (badgeId.includes('like.streak') || badgeId.includes('reaction.streak')) {
        likeStreak = Math.max(likeStreak, progress);
      } else if (badgeId.includes('comment.streak') || badgeId.includes('discussion.streak')) {
        commentStreak = Math.max(commentStreak, progress);
      }
    }

    const durationMs = Date.now() - startTime;
    emitter.stepCompleted('verify', durationMs, {
      visit: visitStreak,
      like: likeStreak,
      comment: commentStreak,
    });

    return {
      result: {
        name: 'verify',
        status: 'completed',
        durationMs,
        retryCount: 0,
        resultData: { visit: visitStreak, like: likeStreak, comment: commentStreak },
      },
      streaks: {
        visit: visitStreak,
        like: likeStreak,
        comment: commentStreak,
      },
    };
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    process.stderr.write(`[WARN] Badge progress verification API failed: ${err.message}\n`);
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
      streaks: {
        visit: -1,
        like: -1,
        comment: -1,
      },
    };
  }
}
