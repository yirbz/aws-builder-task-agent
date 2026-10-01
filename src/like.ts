import type { Page } from 'rebrowser-playwright';
import type { StepResult } from './types.js';
import type { EventEmitter } from './events.js';
import type { DatabaseInstance } from './db.js';
import { getInteractedPostIds, hasRunInteracted, insertInteraction } from './db.js';
import { humanClick, humanScroll, randomDelay } from './human-behavior.js';
import { isValidCommunityArticle, extractPostIdFromUrl } from './article-filter.js';

export async function executeLike(
  page: Page,
  db: DatabaseInstance,
  emitter: EventEmitter,
  runId: string
): Promise<StepResult> {
  const startTime = Date.now();
  emitter.stepStarted('like');

  try {
    // Strict guard: ensure we never like more than once per run
    if (hasRunInteracted(db, runId, 'like')) {
      process.stdout.write(`[LIKE] Article already liked in run ${runId}. Skipping duplicate like.\n`);
      const durationMs = Date.now() - startTime;
      emitter.stepCompleted('like', durationMs, { skipped: true, reason: 'already_liked_in_run' });
      return {
        name: 'like',
        status: 'completed',
        durationMs,
        retryCount: 0,
      };
    }

    const alreadyLikedIds = new Set(getInteractedPostIds(db, 'like'));

    // Ensure we are on feed/explore content page
    if (!page.url().includes('builder.aws.com')) {
      await page.goto('https://builder.aws.com', { waitUntil: 'domcontentloaded' });
    }

    await humanScroll(page);
    await randomDelay(1000, 2000);

    let targetCard = null;
    let targetPostId: string | null = null;
    let targetTitle: string = 'AWS Builder Content';
    let targetUrl: string = page.url();

    // Helper to scan visible cards on current page state
    const scanCards = async () => {
      const articleCards = await page.$$(
        'article, [data-testid*="post-card"], [data-testid*="article-card"], div[class*="PostCard"]'
      );

      for (const card of articleCards) {
        const linkEl = await card.$('a[href*="/post/"], a[href*="/article/"], a[href*="/content/"]');
        let postId: string | null = null;
        let postUrl: string = page.url();
        let postTitle: string = 'AWS Builder Post';

        if (linkEl) {
          const href = await linkEl.getAttribute('href');
          if (href) {
            postUrl = href.startsWith('http') ? href : `https://builder.aws.com${href}`;
            postId = extractPostIdFromUrl(href) || href;
          }
          const text = await linkEl.textContent();
          if (text) postTitle = text.trim();
        }

        if (!postId) {
          postId = (await card.getAttribute('data-post-id')) || (await card.getAttribute('data-id'));
        }

        if (!postId) continue;

        // Filter out if already in SQLite interaction history
        if (alreadyLikedIds.has(postId)) {
          continue;
        }

        // Validate that this is a real community article (not preview, terms, create, etc.)
        if (!isValidCommunityArticle(postUrl, postTitle)) {
          continue;
        }

        // Check if like button exists on this card and is unpressed
        const likeBtn = await card.$(
          'button[aria-label*="like" i], button[aria-label*="reaction" i], button:has(svg[data-testid*="heart"]), button:has(svg[data-testid*="thumbs"])'
        );

        if (likeBtn) {
          const isPressed = await likeBtn.getAttribute('aria-pressed');
          if (isPressed === 'true') {
            // Already liked on platform
            continue;
          }

          return { card, postId, postTitle, postUrl };
        }
      }

      // Fallback search across generic like buttons
      const allLikeButtons = await page.$$(
        'button[aria-label*="like" i], button[aria-label*="reaction" i], button[aria-pressed="false"]'
      );

      for (const btn of allLikeButtons) {
        const isPressed = await btn.getAttribute('aria-pressed');
        if (isPressed === 'true') continue;

        const cardParent = await btn.evaluateHandle((el) =>
          el.closest('article, div[class*="card"], [data-testid*="post"]')
        );
        let idCandidate = `post_${Date.now()}`;
        let candUrl = page.url();
        let candTitle = 'AWS Builder Content';

        if (cardParent) {
          const href = await page.evaluate((el: any) => {
            const a = el?.querySelector?.('a[href*="/"]');
            return a ? a.getAttribute('href') : null;
          }, cardParent);
          if (href) {
            candUrl = href.startsWith('http') ? href : `https://builder.aws.com${href}`;
            idCandidate = extractPostIdFromUrl(href) || href;
          }
        }

        if (isValidCommunityArticle(candUrl, candTitle) && !alreadyLikedIds.has(idCandidate)) {
          return { card: btn, postId: idCandidate, postTitle: candTitle, postUrl: candUrl };
        }
      }

      return null;
    };

    // First scan attempt
    let found = await scanCards();

    // If no unliked articles found on initial view, scroll down to load more (up to 3 times)
    if (!found) {
      for (let i = 0; i < 3; i++) {
        await humanScroll(page);
        await randomDelay(1200, 2500);
        found = await scanCards();
        if (found) break;
      }
    }

    // If still none, navigate to explore feed
    if (!found && !page.url().includes('/explore')) {
      await page.goto('https://builder.aws.com/explore', { waitUntil: 'domcontentloaded' }).catch(() => {});
      await randomDelay(1500, 3000);
      await humanScroll(page);
      found = await scanCards();
    }

    if (!found) {
      throw new Error('No unliked community articles available in feed');
    }

    targetCard = found.card;
    targetPostId = found.postId;
    targetTitle = found.postTitle;
    targetUrl = found.postUrl;

    // Scroll to the card and click the like button exactly once
    await targetCard.scrollIntoViewIfNeeded();
    await randomDelay(800, 1800);

    const btn = await targetCard.$(
      'button[aria-label*="like" i], button[aria-label*="reaction" i], button[aria-pressed="false"]'
    );
    const btnToClick = btn || targetCard;

    await btnToClick.click();
    await randomDelay(1500, 3000);

    // Record interaction in SQLite
    try {
      insertInteraction(db, {
        run_id: runId,
        post_id: targetPostId,
        post_url: targetUrl,
        post_title: targetTitle,
        action_type: 'like',
        comment_text: null,
        created_at: new Date().toISOString(),
      });
    } catch (dbErr: any) {
      if (dbErr.message?.includes('UNIQUE constraint')) {
        throw new Error(`Article ${targetPostId} already liked (dedup collision)`);
      }
      throw dbErr;
    }

    const durationMs = Date.now() - startTime;
    process.stdout.write(`[LIKE] ✅ Successfully liked article "${targetTitle}" (${targetPostId})\n`);
    emitter.stepCompleted('like', durationMs, {
      postId: targetPostId,
      postTitle: targetTitle,
      url: targetUrl,
    });

    return {
      name: 'like',
      status: 'completed',
      durationMs,
      retryCount: 0,
      resultData: { postId: targetPostId, postTitle: targetTitle },
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
