import type { Page } from 'rebrowser-playwright';
import type { StepResult } from './types.js';
import type { EventEmitter } from './events.js';
import type { DatabaseInstance } from './db.js';
import { getInteractedPostIds, insertInteraction } from './db.js';
import { humanScroll, randomDelay } from './human-behavior.js';
import { findCandidateArticles, type ArticleCandidate } from './article-discovery.js';
import { postLikeApi } from './api-client.js';

export async function executeLike(
  page: Page,
  db: DatabaseInstance,
  emitter: EventEmitter,
  runId: string
): Promise<StepResult> {
  const startTime = Date.now();
  emitter.stepStarted('like');

  try {
    const alreadyLikedIds = new Set(getInteractedPostIds(db, 'like'));

    // Ensure we are on feed/explore content page
    if (!page.url().includes('builder.aws.com')) {
      await page.goto('https://builder.aws.com', { waitUntil: 'domcontentloaded' });
    }

    const candidates = await findCandidateArticles(page, alreadyLikedIds);
    if (candidates.length === 0) {
      throw new Error('No unliked articles available after deep feed exploration');
    }

    let success = false;
    let targetCandidate: ArticleCandidate | null = null;

    for (const cand of candidates) {
      // Tier 1: Direct HTTP API reaction call
      const apiLikeSuccess = await postLikeApi(page, cand.postId);
      if (apiLikeSuccess) {
        targetCandidate = cand;
        success = true;
        process.stdout.write(`[LIKE API] ✅ Liked article ${cand.postId} via direct API request.\n`);
        break;
      }

      // Tier 2: DOM-based reaction fallback
      try {
        await page.goto(cand.postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await randomDelay(1500, 3000);

        const headingEl = await page.$('h1, [data-testid*="post-title"], [data-testid*="article-title"]');
        if (headingEl) {
          const titleText = await headingEl.textContent();
          if (titleText) cand.postTitle = titleText.trim();
        }

        await humanScroll(page);
        await randomDelay(1000, 2000);

        const likeBtnSelectors = [
          'button[aria-label*="like" i]',
          'button[aria-label*="upvote" i]',
          'button[aria-label*="reaction" i]',
          'button[aria-label*="heart" i]',
          'button[aria-label*="thumbs" i]',
          '[data-testid*="like"]',
          '[data-testid*="upvote"]',
          '[data-testid*="reaction"]',
          '[data-testid*="heart"]',
          'button:has-text("Like")',
          'button:has-text("Upvote")',
          'article button:has(svg)',
          'main button:has(svg)',
        ];

        let articleLikeBtn = null;
        for (const sel of likeBtnSelectors) {
          const candidate = await page.$(sel);
          if (candidate && (await candidate.isVisible().catch(() => false))) {
            articleLikeBtn = candidate;
            break;
          }
        }

        if (!articleLikeBtn) {
          await page.evaluate(() => window.scrollBy(0, 600));
          await randomDelay(1000, 2000);
          for (const sel of likeBtnSelectors) {
            const candidate = await page.$(sel);
            if (candidate && (await candidate.isVisible().catch(() => false))) {
              articleLikeBtn = candidate;
              break;
            }
          }
        }

        if (articleLikeBtn) {
          await articleLikeBtn.scrollIntoViewIfNeeded().catch(() => {});
          await randomDelay(800, 1500);
          await articleLikeBtn.click();
          await randomDelay(1500, 3000);
          targetCandidate = cand;
          success = true;
          break;
        } else {
          process.stderr.write(`[LIKE] Like button not found on ${cand.postUrl}. Trying next candidate article...\n`);
        }
      } catch (err: any) {
        process.stderr.write(`[LIKE] Error during like on ${cand.postUrl}: ${err.message}. Trying next candidate article...\n`);
      }
    }

    if (!success || !targetCandidate) {
      throw new Error('Could not locate a clickable like button on any explored community articles');
    }

    // Record interaction in SQLite
    try {
      insertInteraction(db, {
        run_id: runId,
        post_id: targetCandidate.postId,
        post_url: targetCandidate.postUrl,
        post_title: targetCandidate.postTitle,
        action_type: 'like',
        comment_text: null,
        created_at: new Date().toISOString(),
      });
    } catch (dbErr: any) {
      if (dbErr.message?.includes('UNIQUE constraint')) {
        throw new Error(`Article ${targetCandidate.postId} already liked (dedup collision)`);
      }
      throw dbErr;
    }

    const durationMs = Date.now() - startTime;
    emitter.stepCompleted('like', durationMs, {
      postId: targetCandidate.postId,
      postTitle: targetCandidate.postTitle,
      url: targetCandidate.postUrl,
    });

    return {
      name: 'like',
      status: 'completed',
      durationMs,
      retryCount: 0,
      resultData: { postId: targetCandidate.postId, postTitle: targetCandidate.postTitle },
    };
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    emitter.stepFailed('like', durationMs, 'retryable', err.message, 0);

    return {
      name: 'like',
      status: 'failed',
      durationMs,
      retryCount: 0,
      errorType: 'retryable',
      errorMessage: err.message,
    };
  }
}
