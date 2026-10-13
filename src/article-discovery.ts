import type { Page } from 'rebrowser-playwright';
import { humanScroll, randomDelay } from './human-behavior.js';
import { fetchRecentPostsApi } from './api-client.js';

export interface ArticleCandidate {
  postId: string;
  postUrl: string;
  postTitle: string;
  isLiked?: boolean;
}

export function isValidPostUrl(href: string): boolean {
  if (!href) return false;

  // Filter out user profile pages, network tabs, followers, settings, badges, etc.
  if (
    href.includes('/@') ||
    href.includes('/network') ||
    href.includes('/followers') ||
    href.includes('/following') ||
    href.includes('/profile') ||
    href.includes('/about') ||
    href.includes('/badges') ||
    href.includes('/settings') ||
    href.includes('#')
  ) {
    return false;
  }

  // Must match explicit article/content path patterns: /content/{id}, /post/{id}, /article/{id}
  return /\/(?:content|post|article)\/([a-zA-Z0-9_-]+)/.test(href);
}

export function extractPostId(href: string): string | null {
  const match = href.match(/\/(?:content|post|article)\/([a-zA-Z0-9_-]+)/);
  if (match && match[1] && match[1].length >= 3) {
    return match[1];
  }
  return null;
}

export async function findCandidateArticles(
  page: Page,
  alreadyInteractedIds: Set<string>
): Promise<ArticleCandidate[]> {
  const candidates: ArticleCandidate[] = [];
  const seenPostIds = new Set<string>();

  // Phase 0: Direct REST API query (/cs/v2/feed/articles)
  try {
    const apiPosts = await fetchRecentPostsApi(page);
    for (const post of apiPosts) {
      if (!alreadyInteractedIds.has(post.postId) && !seenPostIds.has(post.postId)) {
        seenPostIds.add(post.postId);
        candidates.push({
          postId: post.postId,
          postUrl: post.postUrl,
          postTitle: post.postTitle,
          isLiked: post.isLiked,
        });
      }
    }

    // Sort to prioritize fresh, unliked articles first
    candidates.sort((a, b) => {
      if (a.isLiked === false && b.isLiked === true) return -1;
      if (a.isLiked === true && b.isLiked === false) return 1;
      return 0;
    });

    if (candidates.length >= 5) {
      return candidates;
    }
  } catch {}

  const scrapePage = async () => {
    const links = await page.$$('a[href*="/content/"], a[href*="/post/"], a[href*="/article/"]');
    for (const link of links) {
      const href = await link.getAttribute('href');
      if (!href || !isValidPostUrl(href)) continue;

      const postId = extractPostId(href);
      if (!postId || alreadyInteractedIds.has(postId) || seenPostIds.has(postId)) {
        continue;
      }

      const fullUrl = href.startsWith('http') ? href : `https://builder.aws.com${href}`;
      const text = await link.textContent();
      const title = text && text.trim().length > 3 ? text.trim() : 'AWS Builder Content';

      seenPostIds.add(postId);
      candidates.push({ postId, postUrl: fullUrl, postTitle: title });
    }
  };

  // Phase 1: Check initial visible fold
  await scrapePage();

  // Phase 2: Infinite-scroll current feed down to trigger lazy loading of fresh items
  if (candidates.length < 3) {
    for (let i = 0; i < 3; i++) {
      await humanScroll(page);
      await randomDelay(1000, 2000);
      await scrapePage();
      if (candidates.length >= 5) break;
    }
  }

  // Phase 3: If still no candidates, navigate to dedicated content feeds
  if (candidates.length === 0) {
    const discoveryUrls = [
      'https://builder.aws.com/explore',
      'https://builder.aws.com/community',
      'https://builder.aws.com/content',
    ];

    for (const dUrl of discoveryUrls) {
      try {
        await page.goto(dUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await randomDelay(1500, 2500);
        await scrapePage();
        if (candidates.length < 3) {
          await humanScroll(page);
          await randomDelay(1500, 2000);
          await scrapePage();
        }
        if (candidates.length > 0) break;
      } catch {
        continue;
      }
    }
  }

  return candidates;
}
