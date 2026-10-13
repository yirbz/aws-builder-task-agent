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
import { findCandidateArticles, type ArticleCandidate } from './article-discovery.js';
import { postCommentApi } from './api-client.js';

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

    const candidates = await findCandidateArticles(page, alreadyCommentedIds);
    if (candidates.length === 0) {
      throw new Error('No uncommented articles available after deep feed exploration');
    }

    let success = false;
    let targetCandidate: ArticleCandidate | null = null;
    let finalCommentText = '';

    for (const cand of candidates) {
      // Tier 1: Direct HTTP API comment call
      try {
        let generatedText = await commentGenerator.generate({
          title: cand.postTitle,
          preview: 'AWS Builder Center article',
        });
        const apiCommentSuccess = await postCommentApi(page, cand.postId, generatedText);
        if (apiCommentSuccess) {
          targetCandidate = cand;
          finalCommentText = generatedText;
          success = true;
          process.stdout.write(`[COMMENT API] ✅ Commented on article ${cand.postId} via direct API request.\n`);
          break;
        }
      } catch {}

      // Tier 2: DOM-based comment fallback
      try {
        await page.goto(cand.postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await randomDelay(1500, 3000);

        const headingEl = await page.$('h1, [data-testid*="post-title"], [data-testid*="article-title"]');
        if (headingEl) {
          const titleText = await headingEl.textContent();
          if (titleText) cand.postTitle = titleText.trim();
        }

        let previewText = '';
        const bodyParagraphs = await page.$$('article p, main p, div[class*="content"] p');
        for (const p of bodyParagraphs.slice(0, 3)) {
          const pText = await p.textContent();
          if (pText) previewText += ` ${pText.trim()}`;
        }

        await humanScroll(page);
        await randomDelay(2000, 4000);
        await humanScrollToBottom(page);
        await randomDelay(1500, 3000);

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

        let foundSelector: string | null = null;
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
              if (btn && (await btn.isVisible().catch(() => false))) {
                await btn.scrollIntoViewIfNeeded().catch(() => {});
                await randomDelay(300, 500);
                await humanClick(page, sel);
                await randomDelay(1500, 3000);
                for (const inputSel of commentInputSelectors) {
                  const el = await page.$(inputSel);
                  if (el && (await el.isVisible().catch(() => false))) {
                    foundSelector = inputSel;
                    break;
                  }
                }
                if (foundSelector) break;
              }
            } catch {
              continue;
            }
          }
        }

        if (!foundSelector) {
          process.stderr.write(`[COMMENT] Comment input field not found on ${cand.postUrl}. Trying next candidate article...\n`);
          continue;
        }

        let commentText = await commentGenerator.generate({
          title: cand.postTitle,
          preview: previewText.slice(0, 600),
        });

        let attempts = 0;
        while (pastCommentTexts.has(commentText) && attempts < 3) {
          attempts++;
          commentText = await commentGenerator.generate({
            title: cand.postTitle,
            preview: previewText.slice(0, 600),
          });
        }

        await humanType(page, foundSelector, commentText);
        await randomDelay(1000, 2500);

        const submitSelectors = [
          'button[type="submit"]:has-text("Comment")',
          'button:has-text("Post")',
          'button:has-text("Submit")',
          'button:has-text("Publish")',
          'button:has-text("Send")',
          'button[aria-label*="submit" i]',
          '[data-testid*="submit-comment"]',
          '[data-testid*="comment-submit"]',
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
          process.stderr.write(`[COMMENT] Submit button not found on ${cand.postUrl}. Trying next candidate article...\n`);
          continue;
        }

        await humanClick(page, submitSelector);
        await randomDelay(2500, 5000);

        targetCandidate = cand;
        finalCommentText = commentText;
        success = true;
        break;
      } catch (err: any) {
        process.stderr.write(`[COMMENT] Error during comment on ${cand.postUrl}: ${err.message}. Trying next candidate article...\n`);
      }
    }

    if (!success || !targetCandidate) {
      throw new Error('Could not submit a comment on any explored community articles');
    }

    // Persist interaction to SQLite
    insertInteraction(db, {
      run_id: runId,
      post_id: targetCandidate.postId,
      post_url: targetCandidate.postUrl,
      post_title: targetCandidate.postTitle,
      action_type: 'comment',
      comment_text: finalCommentText,
      created_at: new Date().toISOString(),
    });

    const durationMs = Date.now() - startTime;
    emitter.stepCompleted('comment', durationMs, {
      postId: targetCandidate.postId,
      postTitle: targetCandidate.postTitle,
      commentText: finalCommentText,
      url: targetCandidate.postUrl,
    });

    return {
      name: 'comment',
      status: 'completed',
      durationMs,
      retryCount: 0,
      resultData: { postId: targetCandidate.postId, postTitle: targetCandidate.postTitle, commentText: finalCommentText },
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
