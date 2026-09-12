import type { ArticleContext, CommentsConfig } from './types.js';

export class CommentGenerator {
  private config: CommentsConfig;

  constructor(config: CommentsConfig) {
    this.config = config;
  }

  public async generate(article: ArticleContext): Promise<string> {
    const angle = this.getRandomAngle();
    const prompt = this.buildPrompt(article, angle);

    // 1. Try Gemini Flash if configured and preferred
    if (this.config.provider === 'gemini' && this.config.geminiApiKey) {
      try {
        return await this.callGemini(prompt);
      } catch (err: any) {
        process.stderr.write(
          `[WARN] Gemini API failed (${err.message}). Attempting Ollama / template fallback...\n`
        );
      }
    }

    // 2. Try Ollama if configured
    if (this.config.provider === 'ollama' || this.config.ollamaBaseUrl) {
      try {
        return await this.callOllama(prompt);
      } catch (err: any) {
        process.stderr.write(
          `[WARN] Ollama generation failed (${err.message}). Falling back to template engine...\n`
        );
      }
    }

    // 3. Fallback to dynamic template engine
    return this.generateTemplateFallback(article);
  }

  private async callGemini(prompt: string): Promise<string> {
    const model = this.config.geminiModel || 'gemini-2.0-flash';
    const apiKey = this.config.geminiApiKey;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.75,
          maxOutputTokens: 80,
          stopSequences: ['\n\n', 'Note:'],
        },
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs || 8000),
    });

    if (!res.ok) {
      throw new Error(`Gemini HTTP error ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as any;
    const comment = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!comment) throw new Error('Empty response from Gemini API');
    return this.cleanComment(comment);
  }

  private async callOllama(prompt: string): Promise<string> {
    const baseUrl = this.config.ollamaBaseUrl || 'http://localhost:11434';
    const model = this.config.ollamaModel || 'llama3.2:3b';

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        options: { temperature: 0.75, num_predict: 80 },
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs || 8000),
    });

    if (!res.ok) {
      throw new Error(`Ollama HTTP error ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as any;
    const comment = data.message?.content?.trim();
    if (!comment) throw new Error('Empty response from Ollama');
    return this.cleanComment(comment);
  }

  private getRandomAngle(): string {
    const angles = [
      'Focus on a practical implementation gotcha, edge-case, or operational consideration.',
      'Mention a trade-off or compare this approach to an alternative AWS service or pattern.',
      'Highlight a cost-optimization, scalability, or IAM security implication.',
      'Provide brief practitioner agreement with a specific technical point mentioned in the excerpt.',
    ];
    return angles[Math.floor(Math.random() * angles.length)];
  }

  private buildPrompt(article: ArticleContext, angle: string): string {
    const previewExcerpt = article.preview ? article.preview.slice(0, 500) : '';
    return `You are a senior AWS cloud engineer commenting on an AWS Builder Center article.
Write a concise, natural, 1 to 2 sentence comment responding to the article.

Article Title: "${article.title}"
Content Excerpt: "${previewExcerpt}"

Angle: ${angle}

Strict Guidelines:
1. Max 2 sentences (under 40 words total).
2. Sound like a peer developer typing in a hurry. Casual, thoughtful, practical.
3. NEVER start with: "Great article", "Thanks for sharing", "Nice post", "In this post", "This article".
4. Do NOT summarize the article or repeat the title verbatim.
5. Return ONLY the comment text without surrounding quotes or labels.`;
  }

  public cleanComment(text: string): string {
    return text
      .replace(/^["'\s]+|["'\s]+$/g, '') // remove outer quotes
      .replace(/^(Comment|Response|Insight):\s*/i, '') // remove model self-labeling
      .replace(/\n+/g, ' ')
      .trim();
  }

  public generateTemplateFallback(article: ArticleContext): string {
    const text = `${article.title} ${article.preview || ''}`.toLowerCase();

    // Determine domain
    let service = 'this architecture';
    if (text.includes('lambda') || text.includes('serverless') || text.includes('step functions')) {
      service = 'serverless workflows';
    } else if (text.includes('s3') || text.includes('storage') || text.includes('glacier')) {
      service = 'S3 storage patterns';
    } else if (text.includes('dynamodb') || text.includes('nosql') || text.includes('aurora')) {
      service = 'DynamoDB data modeling';
    } else if (
      text.includes('ecs') ||
      text.includes('eks') ||
      text.includes('fargate') ||
      text.includes('docker') ||
      text.includes('container')
    ) {
      service = 'container deployments';
    } else if (
      text.includes('cdk') ||
      text.includes('terraform') ||
      text.includes('cloudformation') ||
      text.includes('iac')
    ) {
      service = 'IaC pipelines';
    } else if (
      text.includes('bedrock') ||
      text.includes('llm') ||
      text.includes('generative ai') ||
      text.includes('claude') ||
      text.includes('sagemaker')
    ) {
      service = 'Bedrock integrations';
    } else if (text.includes('iam') || text.includes('security') || text.includes('kms')) {
      service = 'least-privilege IAM setups';
    }

    const openers = [
      `Solid walkthrough on ${service}.`,
      `Really appreciate the practical breakdown on ${service}.`,
      `Good look at handling ${service} in practice.`,
      `Interesting angle on structuring ${service}.`,
    ];

    const details = [
      `Handling the edge cases and operational trade-offs early always pays off down the road.`,
      `Keeping the configuration lean usually saves so many debugging headaches in production.`,
      `We ran into a similar scenario recently, and this pattern is much cleaner than custom glue scripts.`,
      `Especially agree on prioritizing observability and failure modes before scaling it up.`,
      `The cost and maintenance advantages make this a very pragmatic choice for production.`,
    ];

    const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
    return `${pick(openers)} ${pick(details)}`;
  }
}
