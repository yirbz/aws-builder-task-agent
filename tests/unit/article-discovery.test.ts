import { describe, it, expect } from 'vitest';
import { isValidPostUrl, extractPostId } from '../../src/article-discovery.js';

describe('Article Discovery Helpers', () => {
  it('should identify valid post URLs', () => {
    expect(isValidPostUrl('/content/3JNtXeZax1v5f73FkGvm6EBoQrz/introducing-polls')).toBe(true);
    expect(isValidPostUrl('https://builder.aws.com/post/post_12345')).toBe(true);
    expect(isValidPostUrl('/article/sample-article-slug')).toBe(true);
  });

  it('should filter out user profile and network URLs', () => {
    expect(isValidPostUrl('/community/@yurihiga/network#followers')).toBe(false);
    expect(isValidPostUrl('https://builder.aws.com/community/@user/following')).toBe(false);
    expect(isValidPostUrl('/about')).toBe(false);
    expect(isValidPostUrl('/badges')).toBe(false);
  });

  it('should correctly extract post IDs', () => {
    expect(extractPostId('/content/3JNtXeZax1v5f73FkGvm6EBoQrz/introducing-polls')).toBe('3JNtXeZax1v5f73FkGvm6EBoQrz');
    expect(extractPostId('https://builder.aws.com/post/my-post-id-123')).toBe('my-post-id-123');
    expect(extractPostId('/invalid-url')).toBeNull();
  });
});
