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
import { humanClick, humanScroll, humanScrollToBottom, humanType, randomDelay } from './human-behavior.js';

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

    // Extract title and preview text for LLM context (do this before scrolling down)
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

    // Read through the article naturally (light scroll at the top)
    await humanScroll(page);
    await randomDelay(2000, 4000);

    // Scroll all the way to the bottom where the comment section lives.
    // On AWS Builder Center, the comment area is typically far below the article content.
    await humanScrollToBottom(page);
    await randomDelay(1500, 3000);

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
      'textarea[placeholder*="write" i]',
      'textarea[placeholder*="say" i]',
      'div[contenteditable="true"]',
      '[data-testid*="comment-input"]',
      '[data-testid*="comment-box"]',
      '[data-testid*="comment-field"]',
      'textarea',
    ];

    // First pass: look for already-visible comment input
    let foundSelector: string | null = null;
    for (const sel of commentInputSelectors) {
      const el = await page.$(sel);
      if (el) {
        // Scroll the element into view in case it's just barely off-screen
        await el.scrollIntoViewIfNeeded().catch(() => {});
        await randomDelay(300, 600);
        if (await el.isVisible().catch(() => false)) {
          foundSelector = sel;
          break;
        }
      }
    }

    // Second pass: look for a button/link to open/expand the comment section
    if (!foundSelector) {
      const openCommentSelectors = [
        'button:has-text("Comment")',
        'button:has-text("Add a comment")',
        'button:has-text("Write a comment")',
        'button:has-text("Leave a comment")',
        'button:has-text("Reply")',
        'a:has-text("Comment")',
        'button[aria-label*="comment" i]',
        '[data-testid*="open-comment"]',
        '[data-testid*="add-comment"]',
        '[data-testid*="comment-button"]',
      ];

      for (const sel of openCommentSelectors) {
        try {
          const btn = await page.$(sel);
          if (btn) {
            await btn.scrollIntoViewIfNeeded().catch(() => {});
            await randomDelay(300, 500);
            if (await btn.isVisible().catch(() => false)) {
              await humanClick(page, sel);
              await randomDelay(1500, 3000);
              // Re-check for comment input after clicking
              for (const inputSel of commentInputSelectors) {
                const el = await page.$(inputSel);
                if (el) {
                  await el.scrollIntoViewIfNeeded().catch(() => {});
                  await randomDelay(300, 500);
                  if (await el.isVisible().catch(() => false)) {
                    foundSelector = inputSel;
                    break;
                  }
                }
              }
              if (foundSelector) break;
            }
          }
        } catch {
          continue;
        }
      }
    }

    // Third pass: scroll to absolute bottom again and try one more time
    if (!foundSelector) {
      await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
      await randomDelay(2000, 4000);

      for (const sel of commentInputSelectors) {
        const el = await page.$(sel);
        if (el) {
          await el.scrollIntoViewIfNeeded().catch(() => {});
          await randomDelay(300, 600);
          if (await el.isVisible().catch(() => false)) {
            foundSelector = sel;
            break;
          }
        }
      }
    }

    if (!foundSelector) {
      // Check if user is unauthenticated on this page
      const signInPrompt = await page.$(
        'button:has-text("Sign in"), a[href*="signin"], [data-testid*="signin"], button:has-text("Log in"), a:has-text("Sign in")'
      );
      if (signInPrompt && (await signInPrompt.isVisible().catch(() => false))) {
        throw new Error(
          'Authentication required: "Sign in" prompt detected on article page. Please authenticate via "pnpm run auth".'
        );
      }
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
