import { describe, expect, it } from 'vitest';
import { llmApiError } from '@/lib/server/llm-error-response';

describe('LLM error responses', () => {
  it('preserves a valid upstream Retry-After header on rate limits', async () => {
    const response = llmApiError({
      statusCode: 429,
      responseHeaders: { 'retry-after': '45' },
    });

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('45');
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      errorCode: 'RATE_LIMITED',
    });
  });

  it('does not copy an invalid Retry-After header', () => {
    const response = llmApiError({
      statusCode: 429,
      responseHeaders: { 'retry-after': 'later' },
    });

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBeNull();
  });
});
