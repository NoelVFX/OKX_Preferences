import { OpenRouterClient } from '../src/openrouter-client.ts';
import { describe, it, expect } from 'jest';

const mockResponse = {
  usage: {
    input: 1024,
    output: 512,
    thinking: 3000,
    reasoning: 2000,
    cached: true,
    cacheWrite: false,
    estimatedUSD: 0.75
  },
  model: 'gpt-4o'
};

describe('OpenRouterClient', () => {
  let client: OpenRouterClient;

  beforeEach(() => {
    client = new OpenRouterClient('test-api-key');
  });

  it('should handle missing usage', () => {
    const result = client.fetchUsage({});
    expect(result).toEqual({
      input: 0, output: 0, thinking: 0, reasoning: 0,
      cached: false, cacheWrite: false, estimatedUSD: 0,
      modelId: '', requestId: ''
    });
  });

  it('should parse complete usage', () => {
    const result = client.fetchUsage(mockResponse);
    expect(result).toEqual({
      input: 1024, output: 512, thinking: 3000, reasoning: 2000,
      cached: true, cacheWrite: false, estimatedUSD: 0.75,
      modelId: 'gpt-4o'
    });
  });
});