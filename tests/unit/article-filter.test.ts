import { describe, it, expect } from 'vitest';
import { isValidCommunityArticle, extractPostIdFromUrl } from '../../src/article-filter.js';

describe('Article Filter Utility', () => {
  describe('isValidCommunityArticle', () => {
    it('accepts legitimate community article URLs', () => {
      expect(
        isValidCommunityArticle(
          'https://builder.aws.com/content/3FJHzOaXT0VMejYec43t50qKai1/your-aws-user-groups-story-could-win-you-a-free-ticket-to-reinvent-2026',
          'Your AWS User Groups Story Could Win You a Free Ticket to re:Invent 2026'
        )
      ).toBe(true);

      expect(
        isValidCommunityArticle(
          'https://builder.aws.com/content/2zZHZXurlEsbElK93n76qgqBRRJ',
          'Unlock Your Productivity Potential: Join Q Developer Challenge #1!'
        )
      ).toBe(true);

      expect(
        isValidCommunityArticle(
          'https://builder.aws.com/post/30RE8ujzksom0IUv8TXhxbxe532',
          'CloudWhisper: An AI-Powered CLI Tool for AWS Infra Management'
        )
      ).toBe(true);
    });

    it('rejects preview and draft URLs', () => {
      expect(
        isValidCommunityArticle(
          'https://builder.aws.com/preview/content/3Il9DBHifcKCGK424lr1GO8DgIi?v=3Il9D6VjO8Bc7fVU3k7QvDyN18R',
          'Create an article'
        )
      ).toBe(false);

      expect(
        isValidCommunityArticle(
          'https://builder.aws.com/content/3Il9DBHifcKCGK424lr1GO8DgIi?v=3Il9D6VjO8Bc7fVU3k7QvDyN18R'
        )
      ).toBe(false);
    });

    it('rejects terms and conditions or legal URLs and titles', () => {
      expect(
        isValidCommunityArticle(
          'https://builder.aws.com/content/3JeLJqwvLtOS8auifyqNp4zuWXH/terms-and-conditions-aws-user-groups-free-ticket-to-reinvent-2026-contest',
          'Terms and Conditions: AWS User Groups Free Ticket to re:Invent 2026 contest.'
        )
      ).toBe(false);

      expect(
        isValidCommunityArticle(
          'https://builder.aws.com/content/valid-id',
          'Terms & Conditions'
        )
      ).toBe(false);

      expect(
        isValidCommunityArticle(
          'https://builder.aws.com/content/privacy-policy-updates',
          'Privacy Policy Updates'
        )
      ).toBe(false);
    });

    it('rejects "Create an article" draft links', () => {
      expect(
        isValidCommunityArticle(
          'https://builder.aws.com/content/create-new-article',
          'Create an article'
        )
      ).toBe(false);
    });

    it('rejects internal routes like /signin, /login, or non-article paths', () => {
      expect(isValidCommunityArticle('https://builder.aws.com/signin')).toBe(false);
      expect(isValidCommunityArticle('https://builder.aws.com/explore')).toBe(false);
      expect(isValidCommunityArticle('')).toBe(false);
    });
  });

  describe('extractPostIdFromUrl', () => {
    it('extracts ID from content, post, or article URLs', () => {
      expect(
        extractPostIdFromUrl(
          'https://builder.aws.com/content/3FJHzOaXT0VMejYec43t50qKai1/some-title'
        )
      ).toBe('3FJHzOaXT0VMejYec43t50qKai1');

      expect(
        extractPostIdFromUrl('/post/abc-123_xyz')
      ).toBe('abc-123_xyz');

      expect(
        extractPostIdFromUrl('https://builder.aws.com/explore')
      ).toBeNull();
    });
  });
});
