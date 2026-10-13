import { describe, it, expect, vi } from 'vitest';
import {
  fetchRecentPostsApi,
  postLikeApi,
  postCommentApi,
  recordViewApi,
  extractApiHeaders,
} from '../../src/api-client.js';

describe('API Client for AWS Builder Center', () => {
  it('extractApiHeaders extracts cookies and localStorage tokens', async () => {
    const mockPage = {
      context: () => ({
        cookies: vi.fn().mockResolvedValue([
          { name: 'builder-session-token', value: 'session-abc' },
        ]),
      }),
      evaluate: vi.fn().mockResolvedValue({
        sessionToken: 'session-abc',
        builderId: 'bid-123',
        profileId: 'pid-456',
        bpToken: 'bp-789',
        csrfToken: 'csrf-xyz',
      }),
    } as any;

    const headers = await extractApiHeaders(mockPage);
    expect(headers.sessionToken).toBe('session-abc');
    expect(headers.builderId).toBe('bid-123');
    expect(headers.profileId).toBe('pid-456');
    expect(headers.csrfToken).toBe('csrf-xyz');
    expect(headers.cookieHeader).toContain('builder-session-token=session-abc');
  });

  it('fetchRecentPostsApi maps articles to ApiFeedPost structure', async () => {
    const mockArticles = [
      {
        articleId: '/content/3JNtXeZax1v5f73FkGvm6EBoQrz',
        title: 'Introducing Polls',
        isLiked: false,
      },
      {
        articleId: 'plain-id-456',
        title: 'Kubernetes Guide',
        isLiked: true,
      },
    ];

    const mockPage = {
      evaluate: vi.fn().mockImplementation((fn: any) => {
        return Promise.resolve([
          {
            postId: '3JNtXeZax1v5f73FkGvm6EBoQrz',
            postUrl: 'https://builder.aws.com/content/3JNtXeZax1v5f73FkGvm6EBoQrz',
            postTitle: 'Introducing Polls',
            isLiked: false,
          },
          {
            postId: 'plain-id-456',
            postUrl: 'https://builder.aws.com/content/plain-id-456',
            postTitle: 'Kubernetes Guide',
            isLiked: true,
          },
        ]);
      }),
    } as any;

    const posts = await fetchRecentPostsApi(mockPage);
    expect(posts).toHaveLength(2);
    expect(posts[0].postId).toBe('3JNtXeZax1v5f73FkGvm6EBoQrz');
    expect(posts[0].postUrl).toBe('https://builder.aws.com/content/3JNtXeZax1v5f73FkGvm6EBoQrz');
    expect(posts[0].isLiked).toBe(false);
  });

  it('postLikeApi returns true on successful or deduplicated like', async () => {
    const mockPage = {
      evaluate: vi.fn().mockResolvedValue(true),
    } as any;

    const success = await postLikeApi(mockPage, 'sample-post-id');
    expect(success).toBe(true);
  });

  it('postCommentApi returns true on successful comment submission', async () => {
    const mockPage = {
      evaluate: vi.fn().mockResolvedValue(true),
    } as any;

    const success = await postCommentApi(mockPage, 'sample-post-id', 'Great article!');
    expect(success).toBe(true);
  });

  it('recordViewApi returns true on view recorded', async () => {
    const mockPage = {
      evaluate: vi.fn().mockResolvedValue(true),
    } as any;

    const success = await recordViewApi(mockPage, 'sample-post-id');
    expect(success).toBe(true);
  });
});
