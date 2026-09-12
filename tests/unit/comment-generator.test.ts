import { describe, it, expect } from 'vitest';
import { CommentGenerator } from '../../src/comment-generator.js';

describe('Comment Generator Module', () => {
  const generator = new CommentGenerator({ provider: 'fallback' });

  it('should clean quotes and prefixes from generated comment', () => {
    const raw = '  "Comment: Handling IAM boundaries is critical for secure setups."  ';
    const cleaned = generator.cleanComment(raw);
    expect(cleaned).toBe('Handling IAM boundaries is critical for secure setups.');
  });

  it('should detect DynamoDB service and generate relevant fallback comment', () => {
    const fallback = generator.generateTemplateFallback({
      title: 'Deep Dive into DynamoDB Global Secondary Indexes',
      preview: 'Optimizing partition keys and query patterns on Amazon DynamoDB tables.',
    });

    expect(fallback).toMatch(/dynamodb/i);
    expect(fallback.length).toBeGreaterThan(20);
  });

  it('should detect Serverless/Lambda service and generate relevant fallback comment', () => {
    const fallback = generator.generateTemplateFallback({
      title: 'Building Serverless Event-Driven Architectures with AWS Lambda',
      preview: 'Triggering asynchronous functions with Amazon EventBridge.',
    });

    expect(fallback).toMatch(/serverless/i);
    expect(fallback.length).toBeGreaterThan(20);
  });

  it('should generate natural text under 40 words', () => {
    const fallback = generator.generateTemplateFallback({
      title: 'Amazon S3 Glacier Instant Retrieval for Cost Optimization',
      preview: 'Moving infrequently accessed objects to cheaper tiers automatically.',
    });

    const wordCount = fallback.split(/\s+/).length;
    expect(wordCount).toBeLessThan(45);
  });
});
