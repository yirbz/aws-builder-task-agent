import type { Page } from 'rebrowser-playwright';
import type { StepResult } from './types.js';
import type { EventEmitter } from './events.js';
import type { DatabaseInstance } from './db.js';
import {
  getInteractedPostIds,
  getAllInteractedCommentTexts,
  hasRunInteracted,
  insertInteraction,
} from './db.js';
import type { CommentGenerator } from './comment-generator.js';
import { humanClick, humanScroll, humanScrollToBottom, humanType, randomDelay } from './human-behavior.js';
import { isValidCommunityArticle, extractPostIdFromUrl } from './article-filter.js';

interface CandidateArticle {
  id: string;
  url: string;
  title: string;
}

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
    // Strict guard: ensure we never comment more than once per run
    if (hasRunInteracted(db, runId, 'comment')) {
      process.stdout.write(`[COMMENT] Comment already submitted in run ${runId}. Skipping duplicate comment.\n`);
      const durationMs = Date.now() - startTime;
      emitter.stepCompleted('comment', durationMs, { skipped: true, reason: 'already_commented_in_run' });
      return {
        name: 'comment',
        status: 'completed',
        durationMs,
        retryCount: 0,
      };
    }

    const alreadyCommentedIds = new Set(getInteractedPostIds(db, 'comment'));
    const pastCommentTexts = new Set(getAllInteractedCommentTexts(db));

    // Ensure we are on feed/explore content page
    if (!page.url().includes('builder.aws.com')) {
      await page.goto('https://builder.aws.com', { waitUntil: 'domcontentloaded' });
    }

    await humanScroll(page);
    await randomDelay(1000, 2000);

    // Helper to extract valid candidate articles from current page
    const collectCandidates = async (): Promise<CandidateArticle[]> => {
      const candidates: CandidateArticle[] = [];
      const seenIds = new Set<string>();

      const links = await page.$$(
        'a[href*="/post/"], a[href*="/article/"], a[href*="/content/"], article a, [data-testid*="post"] a, [data-testid*="card"] a'
      );

      for (const link of links) {
        const href = await link.getAttribute('href');
        if (!href) continue;

        const fullUrl = href.startsWith('http') ? href : `https://builder.aws.com${href}`;
        const postId = extractPostIdFromUrl(href) || href;

        if (seenIds.has(postId) || alreadyCommentedIds.has(postId)) {
          continue;
        }

        let linkTitle = 'AWS Builder Community Article';
        const text = await link.textContent();
        if (text && text.trim().length > 3) {
          linkTitle = text.trim();
        }

        // Validate that this is a real community article (not preview, terms, create, etc.)
        if (!isValidCommunityArticle(fullUrl, linkTitle)) {
          continue;
        }

        seenIds.add(postId);
        candidates.push({
          id: postId,
          url: fullUrl,
          title: linkTitle,
        });

        if (candidates.length >= 10) break;
      }

      return candidates;
    };

    let candidates = await collectCandidates();

    // If fewer than 3 candidates found on initial view, scroll down to load more cards
    if (candidates.length < 3) {
      for (let i = 0; i < 3; i++) {
        await humanScroll(page);
        await randomDelay(1200, 2500);
        candidates = await collectCandidates();
        if (candidates.length >= 5) break;
      }
    }

    // If still few candidates, navigate to explore page to gather fresh articles
    if (candidates.length < 2 && !page.url().includes('/explore')) {
      process.stdout.write(`[COMMENT] Few candidates on home feed (${candidates.length}). Exploring /explore...\n`);
      await page.goto('https://builder.aws.com/explore', { waitUntil: 'domcontentloaded' }).catch(() => {});
      await randomDelay(1500, 3000);
      await humanScroll(page);
      candidates = await collectCandidates();
    }

    if (candidates.length === 0) {
      throw new Error('No uncommented community articles available in feed or explore');
    }

    process.stdout.write(`[COMMENT] Found ${candidates.length} candidate community article(s) to explore.\n`);

    const commentInputSelectors = [
      'textarea[placeholder*="comment" i]',
      'textarea[placeholder*="thoughts" i]',
      'textarea[placeholder*="reply" i]',
      'textarea[placeholder*="write" i]',
      'textarea[placeholder*="say" i]',
      'textarea[placeholder*="add" i]',
      'textarea[placeholder*="share" i]',
      'textarea[name*="comment" i]',
      'textarea[id*="comment" i]',
      'div[role="textbox"]',
      'div[contenteditable="true"]',
      '[data-testid*="comment-input"]',
      '[data-testid*="comment-box"]',
      '[data-testid*="comment-field"]',
      '[data-testid*="comment-textarea"]',
      'div[class*="comment" i] textarea',
      'div[class*="comment" i] [contenteditable="true"]',
      'div[class*="comment" i] div[role="textbox"]',
      'section[class*="comment" i] textarea',
      'section[class*="comment" i] [contenteditable="true"]',
      'section[class*="comment" i] div[role="textbox"]',
      'textarea',
    ];

    const openCommentSelectors = [
      'button:has-text("Comment")',
      'button:has-text("Comments")',
      'button:has-text("Add a comment")',
      'button:has-text("Write a comment")',
      'button:has-text("Leave a comment")',
      'button:has-text("Reply")',
      'button:has-text("Join the discussion")',
      'a:has-text("Comment")',
      'a:has-text("Comments")',
      'button[aria-label*="comment" i]',
      'button[aria-label*="reply" i]',
      '[data-testid*="open-comment"]',
      '[data-testid*="add-comment"]',
      '[data-testid*="comment-button"]',
      'div[class*="comment-placeholder"]',
      'div[class*="comment-trigger"]',
    ];

    const submitSelectors = [
      'button:has-text("Comment")',
      'button[type="submit"]:has-text("Comment")',
      'button:has-text("Post")',
      'button[type="submit"]:has-text("Post")',
      'button:has-text("Submit")',
      'button[type="submit"]:has-text("Submit")',
      'button:has-text("Publish")',
      'button:has-text("Send")',
      'button[aria-label*="submit" i]',
      'button[aria-label*="comment" i]',
      'button[aria-label*="post" i]',
      '[data-testid*="submit-comment"]',
      '[data-testid*="post-comment"]',
      '[data-testid*="comment-submit"]',
    ];

    let lastError: Error | null = null;
    const maxAttempts = Math.min(candidates.length, 6);

    for (let i = 0; i < maxAttempts; i++) {
      const candidate = candidates[i];
      process.stdout.write(
        `[COMMENT] Evaluating candidate ${i + 1}/${maxAttempts}: "${candidate.title}" (${candidate.url})\n`
      );

      try {
        await page.goto(candidate.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await randomDelay(1500, 3000);

        // Guard against redirects to login or non-article pages
        const currentUrl = page.url();
        if (!isValidCommunityArticle(currentUrl)) {
          process.stdout.write(`[COMMENT] Candidate redirected to invalid path: ${currentUrl}. Trying next candidate article...\n`);
          continue;
        }

        // Check for sign-in prompt indicating unauthenticated view
        const signInPrompt = await page.$(
          'button:has-text("Sign in"), a[href*="signin"], [data-testid*="signin"], button:has-text("Log in")'
        );
        if (signInPrompt && (await signInPrompt.isVisible().catch(() => false))) {
          process.stdout.write(`[COMMENT] Sign-in prompt displayed on ${candidate.url}. Trying next candidate article...\n`);
          continue;
        }

        // Extract title and preview text for LLM context
        let articleTitle = candidate.title;
        const headingEl = await page.$('h1, [data-testid*="post-title"], [data-testid*="article-title"]');
        if (headingEl) {
          const titleText = await headingEl.textContent();
          if (titleText && titleText.trim().length > 3) articleTitle = titleText.trim();
        }

        let previewText = '';
        const bodyParagraphs = await page.$$('article p, main p, div[class*="content"] p');
        for (const p of bodyParagraphs.slice(0, 3)) {
          const pText = await p.textContent();
          if (pText) previewText += ` ${pText.trim()}`;
        }

        // Read through article naturally
        await humanScroll(page);
        await randomDelay(1500, 3000);

        // Scroll down to comments area
        await humanScrollToBottom(page);
        await randomDelay(1500, 2500);

        // Check for visible comment input
        let foundSelector: string | null = null;
        for (const sel of commentInputSelectors) {
          const el = await page.$(sel);
          if (el) {
            await el.scrollIntoViewIfNeeded().catch(() => {});
            await randomDelay(200, 400);
            if (await el.isVisible().catch(() => false)) {
              foundSelector = sel;
              break;
            }
          }
        }

        // If not found, attempt clicking open/expand comment triggers
        if (!foundSelector) {
          for (const sel of openCommentSelectors) {
            try {
              const btn = await page.$(sel);
              if (btn && (await btn.isVisible().catch(() => false))) {
                await btn.scrollIntoViewIfNeeded().catch(() => {});
                await humanClick(page, sel);
                await randomDelay(1500, 2500);
                break;
              }
            } catch {
              continue;
            }
          }

          // Re-check input selectors after expanding
          for (const inputSel of commentInputSelectors) {
            const el = await page.$(inputSel);
            if (el) {
              await el.scrollIntoViewIfNeeded().catch(() => {});
              await randomDelay(200, 400);
              if (await el.isVisible().catch(() => false)) {
                foundSelector = inputSel;
                break;
              }
            }
          }
        }

        // If still no comment input on this article, move to next candidate
        if (!foundSelector) {
          process.stdout.write(
            `[COMMENT] Comment input field not found on ${candidate.url}. Trying next candidate article...\n`
          );
          continue;
        }

        // Generate unique comment
        let commentText = await commentGenerator.generate({
          title: articleTitle,
          preview: previewText.slice(0, 600),
        });

        let attempts = 0;
        while (pastCommentTexts.has(commentText) && attempts < 3) {
          attempts++;
          commentText = await commentGenerator.generate({
            title: articleTitle,
            preview: previewText.slice(0, 600),
          });
        }

        // Type comment with human-like keystroke intervals
        await humanType(page, foundSelector, commentText);
        await randomDelay(1000, 2500);

        // Locate submit button
        let submitSelector: string | null = null;
        for (const sel of submitSelectors) {
          const el = await page.$(sel);
          if (el && (await el.isVisible().catch(() => false))) {
            submitSelector = sel;
            break;
          }
        }

        if (!submitSelector) {
          process.stdout.write(
            `[COMMENT] Submit button not found on ${candidate.url}. Trying next candidate article...\n`
          );
          continue;
        }

        await humanClick(page, submitSelector);
        await randomDelay(3000, 5000);

        // Persist interaction to SQLite
        insertInteraction(db, {
          run_id: runId,
          post_id: candidate.id,
          post_url: candidate.url,
          post_title: articleTitle,
          action_type: 'comment',
          comment_text: commentText,
          created_at: new Date().toISOString(),
        });

        const durationMs = Date.now() - startTime;
        process.stdout.write(
          `[COMMENT] ✅ Successfully commented on "${articleTitle}" (${candidate.id})\n`
        );
        emitter.stepCompleted('comment', durationMs, {
          postId: candidate.id,
          postTitle: articleTitle,
          commentText,
          url: candidate.url,
        });

        return {
          name: 'comment',
          status: 'completed',
          durationMs,
          retryCount: i,
          resultData: { postId: candidate.id, postTitle: articleTitle, commentText },
        };
      } catch (candidateErr: any) {
        process.stderr.write(
          `[COMMENT] Error attempting candidate ${candidate.url}: ${candidateErr.message}\n`
        );
        lastError = candidateErr;
        continue;
      }
    }

    throw new Error(
      lastError
        ? `Could not submit a comment on any explored community articles: ${lastError.message}`
        : 'Could not submit a comment on any explored community articles'
    );
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
