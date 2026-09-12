import type { Page } from 'rebrowser-playwright';
import type { StepResult } from './types.js';
import type { EventEmitter } from './events.js';
import type { DatabaseInstance } from './db.js';
import {
  getInteractedPostIds,
  getAllInteractedCommentTexts,
  insertInteraction,
} from './db.js';
import type { CommentGenerator } from './comment-generator.js';
import { humanClick, humanScroll, humanType, randomDelay } from './human-behavior.js';

export async function executeComment(
  page: Page,
  db: DatabaseInstance,
  commentGenerator: CommentGenerator,
  emitter: EventEmitter,
  runId: string
): Promise<StepResult> {
  const startTime = Date.now();
  emitter.stepStarted('comment');

  try {
    const alreadyCommentedIds = new Set(getInteractedPostIds(db, 'comment'));
    const pastCommentTexts = new Set(getAllInteractedCommentTexts(db));

    // Ensure we are on feed/explore content page
    if (!page.url().includes('builder.aws.com')) {
      await page.goto('https://builder.aws.com', { waitUntil: 'domcontentloaded' });
    }

    await humanScroll(page);
    await randomDelay(1000, 2000);

    // Find an article link that hasn't been commented on
    const links = await page.$$('a[href*="/post/"], a[href*="/article/"], a[href*="/content/"]');
    let targetLink = null;
    let targetPostId: string | null = null;
    let targetUrl: string | null = null;
    let targetTitle: string = 'AWS Builder Community Article';

    for (const link of links) {
      const href = await link.getAttribute('href');
      if (!href) continue;

      const fullUrl = href.startsWith('http') ? href : `https://builder.aws.com${href}`;
      const match = href.match(/\/(?:post|article|content)\/([a-zA-Z0-9_-]+)/);
      const postId = match ? match[1] : href;

      if (!alreadyCommentedIds.has(postId)) {
        targetLink = link;
        targetPostId = postId;
        targetUrl = fullUrl;
        const text = await link.textContent();
        if (text && text.trim().length > 3) {
          targetTitle = text.trim();
        }
        break;
      }
    }

    if (!targetPostId || !targetUrl) {
      throw new Error('No uncommented articles available in current feed');
    }

    // Navigate to article page
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(1500, 3000);

    // Read through the article naturally
    await humanScroll(page);
    await randomDelay(2000, 4000);

    // Extract title and preview text for LLM context
    const headingEl = await page.$('h1, [data-testid*="post-title"], [data-testid*="article-title"]');
    if (headingEl) {
      const titleText = await headingEl.textContent();
      if (titleText) targetTitle = titleText.trim();
    }

    let previewText = '';
    const bodyParagraphs = await page.$$('article p, main p, div[class*="content"] p');
    for (const p of bodyParagraphs.slice(0, 3)) {
      const pText = await p.textContent();
      if (pText) previewText += ` ${pText.trim()}`;
    }

    // Generate unique comment
    let commentText = await commentGenerator.generate({
      title: targetTitle,
      preview: previewText.slice(0, 600),
    });

    // Guard against duplicate comments across the 90-day streak
    let attempts = 0;
    while (pastCommentTexts.has(commentText) && attempts < 3) {
      attempts++;
      commentText = await commentGenerator.generate({
        title: targetTitle,
        preview: previewText.slice(0, 600),
      });
    }

    // Locate comment input box (textarea, contenteditable, or input)
    const commentInputSelectors = [
      'textarea[placeholder*="comment" i]',
      'textarea[placeholder*="thoughts" i]',
      'textarea[placeholder*="reply" i]',
      'div[contenteditable="true"]',
      '[data-testid*="comment-input"]',
      'textarea',
    ];

    let foundSelector: string | null = null;
    for (const sel of commentInputSelectors) {
      const el = await page.$(sel);
      if (el && (await el.isVisible().catch(() => false))) {
        foundSelector = sel;
        break;
      }
    }

    if (!foundSelector) {
      // Look for a button to open comment section first
      const openCommentBtn = await page.$(
        'button:has-text("Comment"), button[aria-label*="comment" i], [data-testid*="open-comment"]'
      );
      if (openCommentBtn && (await openCommentBtn.isVisible().catch(() => false))) {
        await humanClick(page, 'button:has-text("Comment"), button[aria-label*="comment" i]');
        await randomDelay(1000, 2000);
        for (const sel of commentInputSelectors) {
          const el = await page.$(sel);
          if (el && (await el.isVisible().catch(() => false))) {
            foundSelector = sel;
            break;
          }
        }
      }
    }

    if (!foundSelector) {
      throw new Error('Comment input field could not be found on page');
    }

    // Type comment with human-like delays
    await humanType(page, foundSelector, commentText);
    await randomDelay(1000, 2500);

    // Locate submit button
    const submitSelectors = [
      'button[type="submit"]:has-text("Comment")',
      'button:has-text("Post")',
      'button:has-text("Submit")',
      'button:has-text("Send")',
      'button[aria-label*="submit" i]',
      '[data-testid*="submit-comment"]',
    ];

    let submitSelector: string | null = null;
    for (const sel of submitSelectors) {
      const el = await page.$(sel);
      if (el && (await el.isVisible().catch(() => false))) {
        submitSelector = sel;
        break;
      }
    }

    if (!submitSelector) {
      throw new Error('Comment submit button could not be found');
    }

    await humanClick(page, submitSelector);
    await randomDelay(2500, 5000);

    // Persist interaction to SQLite
    insertInteraction(db, {
      run_id: runId,
      post_id: targetPostId,
      post_url: targetUrl,
      post_title: targetTitle,
      action_type: 'comment',
      comment_text: commentText,
      created_at: new Date().toISOString(),
    });

    const durationMs = Date.now() - startTime;
    emitter.stepCompleted('comment', durationMs, {
      postId: targetPostId,
      postTitle: targetTitle,
      commentText,
      url: targetUrl,
    });

    return {
      name: 'comment',
      status: 'completed',
      durationMs,
      retryCount: 0,
      resultData: { postId: targetPostId, postTitle: targetTitle, commentText },
    };
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    emitter.stepFailed('comment', durationMs, 'retryable', err.message, 0);

    return {
      name: 'comment',
      status: 'failed',
      durationMs,
      retryCount: 0,
      errorType: 'retryable',
      errorMessage: err.message,
    };
  }
}
