import type { Page } from 'rebrowser-playwright';

export interface ApiAuthHeaders {
  sessionToken?: string;
  builderId?: string;
  profileId?: string;
  bpToken?: string;
  csrfToken?: string;
  cookieHeader?: string;
}

export interface ApiFeedPost {
  postId: string;
  postUrl: string;
  postTitle: string;
  isLiked?: boolean;
}

/**
 * Extracts authentication tokens, cookies, and CSRF token from page context.
 */
export async function extractApiHeaders(page: Page): Promise<ApiAuthHeaders> {
  const cookies = await page.context().cookies(['https://builder.aws.com', 'https://api.builder.aws.com']);
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

  const localStorageData = (await page.evaluate(() => {
    return {
      sessionToken: localStorage.getItem('builder-session-token') || undefined,
      builderId: localStorage.getItem('builder-id') || undefined,
      profileId: localStorage.getItem('builder-profile-id') || undefined,
      bpToken: localStorage.getItem('builder-bp-token') || undefined,
      csrfToken: localStorage.getItem('aws-bingo-csrf-token') || undefined,
    };
  }).catch(() => ({}))) as Record<string, string | undefined>;

  const sessionToken = localStorageData.sessionToken || cookies.find((c) => c.name === 'builder-session-token')?.value;

  return {
    sessionToken,
    builderId: localStorageData.builderId,
    profileId: localStorageData.profileId,
    bpToken: localStorageData.bpToken,
    csrfToken: localStorageData.csrfToken,
    cookieHeader,
  };
}

/**
 * Fetches recent articles directly via AWS Builder Center's Content Services API:
 * GET https://api.builder.aws.com/cs/v2/feed/articles?pageSize=20&sortBy=TRENDING_SCORE
 */
export async function fetchRecentPostsApi(page: Page): Promise<ApiFeedPost[]> {
  try {
    const posts = await page.evaluate(async () => {
      const csrfToken = localStorage.getItem('aws-bingo-csrf-token');
      const sessionToken = localStorage.getItem('builder-session-token') || 'dummy';

      const headers: Record<string, string> = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'builder-session-token': sessionToken,
      };
      if (csrfToken) headers['x-csrf-token'] = csrfToken;

      try {
        const res = await fetch('https://api.builder.aws.com/cs/v2/feed/articles?pageSize=20&sortBy=TRENDING_SCORE', {
          method: 'GET',
          credentials: 'include',
          headers,
        });

        if (res.ok) {
          const data = await res.json();
          const articles = data.articles || [];
          if (Array.isArray(articles) && articles.length > 0) {
            return articles
              .map((item: any) => {
                const rawId = item.articleId || item.id || item.contentId || '';
                const cleanId = rawId.replace(/^\/?content\//, '');
                const url = `https://builder.aws.com/content/${cleanId}`;
                const title = item.title || item.name || 'AWS Builder Post';
                return {
                  postId: cleanId,
                  postUrl: url,
                  postTitle: title,
                  isLiked: !!item.isLiked,
                };
              })
              .filter((p: any) => p.postId);
          }
        }
      } catch {}

      return [];
    });

    if (Array.isArray(posts) && posts.length > 0) {
      return posts;
    }
  } catch {
    // Return empty array to trigger DOM scraping fallback
  }

  return [];
}

/**
 * Likes an article directly via AWS Builder Center's Content Services API:
 * POST https://api.builder.aws.com/cs/content/like
 */
export async function postLikeApi(page: Page, postId: string): Promise<boolean> {
  try {
    const success = await page.evaluate(async (rawId) => {
      const csrfToken = localStorage.getItem('aws-bingo-csrf-token');
      const sessionToken = localStorage.getItem('builder-session-token') || 'dummy';

      const headers: Record<string, string> = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'builder-session-token': sessionToken,
      };
      if (csrfToken) headers['x-csrf-token'] = csrfToken;

      const contentId = rawId.startsWith('/content/') ? rawId : `/content/${rawId}`;

      const res = await fetch('https://api.builder.aws.com/cs/content/like', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          contentId,
          contentType: 'ARTICLE',
          like: true,
        }),
      });

      // 200 = Success, 409 = Duplicated request for like (already liked)
      if (res.status === 200 || res.status === 201 || res.status === 409) {
        return true;
      }

      return false;
    }, postId);

    return !!success;
  } catch {
    return false;
  }
}

/**
 * Comments on an article directly via AWS Builder Center's Content Services API:
 * POST https://api.builder.aws.com/cs/v2/comments
 */
export async function postCommentApi(page: Page, postId: string, commentText: string): Promise<boolean> {
  try {
    const success = await page.evaluate(async ({ rawId, text }) => {
      const csrfToken = localStorage.getItem('aws-bingo-csrf-token');
      const sessionToken = localStorage.getItem('builder-session-token') || 'dummy';

      const headers: Record<string, string> = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'builder-session-token': sessionToken,
      };
      if (csrfToken) headers['x-csrf-token'] = csrfToken;

      const contentId = rawId.startsWith('/content/') ? rawId : `/content/${rawId}`;

      const res = await fetch('https://api.builder.aws.com/cs/v2/comments', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          markdownDescription: text,
          parent: {
            contentId,
            contentType: 'ARTICLE',
          },
        }),
      });

      if (res.status === 200 || res.status === 201) {
        return true;
      }

      return false;
    }, { rawId: postId, text: commentText });

    return !!success;
  } catch {
    return false;
  }
}

/**
 * Records an article view directly via AWS Builder Center's Content Services API:
 * POST https://api.builder.aws.com/cs/content/view
 */
export async function recordViewApi(page: Page, postId: string): Promise<boolean> {
  try {
    const success = await page.evaluate(async (rawId) => {
      const csrfToken = localStorage.getItem('aws-bingo-csrf-token');
      const sessionToken = localStorage.getItem('builder-session-token') || 'dummy';

      const headers: Record<string, string> = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'builder-session-token': sessionToken,
      };
      if (csrfToken) headers['x-csrf-token'] = csrfToken;

      const contentId = rawId.startsWith('/content/') ? rawId : `/content/${rawId}`;

      const res = await fetch('https://api.builder.aws.com/cs/content/view', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          contentId,
          contentType: 'ARTICLE',
        }),
      });

      return res.ok;
    }, postId);

    return !!success;
  } catch {
    return false;
  }
}
