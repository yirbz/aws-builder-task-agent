import type { Page } from 'rebrowser-playwright';
import type { StepResult } from './types.js';
import type { EventEmitter } from './events.js';
import type { DatabaseInstance } from './db.js';
import { getInteractedPostIds, insertInteraction } from './db.js';
import { humanClick, humanScroll, randomDelay } from './human-behavior.js';

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

    await humanScroll(page);
    await randomDelay(1000, 2500);

    // Scan for article cards and like buttons
    // Builder Center posts typically contain links with /posts/ or /articles/ or cards with like buttons
    const articleCards = await page.$$('article, [data-testid*="post-card"], [data-testid*="article-card"], div[class*="PostCard"]');

    let targetCard = null;
    let targetPostId: string | null = null;
    let targetTitle: string = 'AWS Builder Content';
    let targetUrl: string = page.url();
    let likeButtonSelector: string | null = null;

    for (const card of articleCards) {
      // Try to extract post id from links or data attributes
      const linkEl = await card.$('a[href*="/post/"], a[href*="/article/"], a[href*="/content/"]');
      let postId: string | null = null;
      let postUrl: string = page.url();
      let postTitle: string = 'AWS Builder Post';

      if (linkEl) {
        const href = await linkEl.getAttribute('href');
        if (href) {
          postUrl = href.startsWith('http') ? href : `https://builder.aws.com${href}`;
          const match = href.match(/\/(?:post|article|content)\/([a-zA-Z0-9_-]+)/);
          postId = match ? match[1] : href;
        }
        const text = await linkEl.textContent();
        if (text) postTitle = text.trim();
      }

      if (!postId) {
        // Fallback: check data-post-id or data-id
        postId = (await card.getAttribute('data-post-id')) || (await card.getAttribute('data-id'));
      }

      if (!postId) continue;

      // Filter out if already in SQLite interaction history
      if (alreadyLikedIds.has(postId)) {
        continue;
      }

      // Check if like button exists on this card and is unpressed
      const likeBtn = await card.$(
        'button[aria-label*="like" i], button[aria-label*="reaction" i], button:has(svg[data-testid*="heart"]), button:has(svg[data-testid*="thumbs"])'
      );

      if (likeBtn) {
        const isPressed = await likeBtn.getAttribute('aria-pressed');
        if (isPressed === 'true') {
          // Already liked directly on platform
          continue;
        }

        targetCard = card;
        targetPostId = postId;
        targetTitle = postTitle;
        targetUrl = postUrl;
        break;
      }
    }

    // Fallback search if structured cards not matching specific container tags
    if (!targetPostId) {
      const allLikeButtons = await page.$$(
        'button[aria-label*="like" i], button[aria-label*="reaction" i], button[aria-pressed="false"]'
      );

      for (const btn of allLikeButtons) {
        const isPressed = await btn.getAttribute('aria-pressed');
        if (isPressed === 'true') continue;

        // Try to identify closest ancestor link or id
        const cardParent = await btn.evaluateHandle((el) =>
          el.closest('article, div[class*="card"], [data-testid*="post"]')
        );
        let idCandidate = `post_${Date.now()}`;
        if (cardParent) {
          const href = await page.evaluate((el: any) => {
            const a = el?.querySelector?.('a[href*="/"]');
            return a ? a.getAttribute('href') : null;
          }, cardParent);
          if (href) {
            const match = href.match(/\/(?:post|article|content)\/([a-zA-Z0-9_-]+)/);
            idCandidate = match ? match[1] : href;
          }
        }

        if (!alreadyLikedIds.has(idCandidate)) {
          targetPostId = idCandidate;
          targetCard = btn;
          break;
        }
      }
    }

    if (!targetPostId || !targetCard) {
      throw new Error('No unliked articles available in visible feed');
    }

    // Scroll to the card and click the like button
    await targetCard.scrollIntoViewIfNeeded();
    await randomDelay(800, 2000);

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
