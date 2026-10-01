/**
 * Determines whether a URL or link is a valid, commentable and interactable community article on AWS Builder Center.
 * Excludes preview URLs, drafting pages, legal/terms, sign-in redirects, and non-article routes.
 */
export function isValidCommunityArticle(url: string, title?: string): boolean {
  if (!url) return false;

  const lowerUrl = url.toLowerCase();

  // Exclude non-article / internal / draft / legal routes
  if (
    lowerUrl.includes('/preview/') ||
    lowerUrl.includes('/create') ||
    lowerUrl.includes('/edit') ||
    lowerUrl.includes('/terms') ||
    lowerUrl.includes('/privacy') ||
    lowerUrl.includes('/guidelines') ||
    lowerUrl.includes('/rules') ||
    lowerUrl.includes('/legal') ||
    lowerUrl.includes('/signin') ||
    lowerUrl.includes('/login') ||
    lowerUrl.includes('/auth') ||
    lowerUrl.includes('?v=') ||
    lowerUrl.includes('&v=')
  ) {
    return false;
  }

  // Must match valid content/post/article pattern: /content/<id>, /post/<id>, /article/<id>
  const match = url.match(/\/(?:post|article|content)\/([a-zA-Z0-9_-]+)/);
  if (!match) {
    return false;
  }

  const articleId = match[1].toLowerCase();
  // Exclude placeholder IDs
  if (['preview', 'create', 'edit', 'draft', 'new', 'terms', 'privacy'].includes(articleId)) {
    return false;
  }

  if (title) {
    const lowerTitle = title.toLowerCase().trim();
    if (
      lowerTitle.includes('terms and conditions') ||
      lowerTitle.includes('terms & conditions') ||
      lowerTitle.includes('create an article') ||
      lowerTitle.includes('create article') ||
      lowerTitle.includes('write a post') ||
      lowerTitle.includes('privacy policy') ||
      lowerTitle.includes('community guidelines')
    ) {
      return false;
    }
  }

  return true;
}

export function extractPostIdFromUrl(url: string): string | null {
  const match = url.match(/\/(?:post|article|content)\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}
