// OpenRouter API client
import fetch from 'node-fetch';

export class OpenRouterClient {
  constructor(apiKey, baseUrl = 'https://openrouter.ai/api/v1') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;

    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY is required');
    }
  }

  async fetchUsage(response) {
    // Parse usage from OpenRouter response
    if (!response || !response.usage) return {};
    const usage = response.usage;

    return {
      input: usage.input?.toString() || 0,
      output: usage.output?.toString() || 0,
      thinking: usage.thinking?.toString() || 0,
      reasoning: usage.reasoning?.toString() || 0,
      cached: usage.cached || false,
      cacheWrite: usage.cacheWrite || false,
      estimatedUSD: usage.estimatedUSD || 0,
      modelId: response.model || '',
      requestId: response.requestId || ''
    };
  }

  async generateDraftFusion(panelModels, prompt, context) {
    // Parallel panel calls with timeout
    const results = await Promise.all(
      panelModels.map(async (model) => {
        try {
          const response = await fetch(`${this.baseUrl}/completions`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: model,
              prompt: prompt,
              context: context
            })
          });

          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return await response.json();
        } catch (error) {
          console.error(`Error with model ${model}:`, error);
          return { error: error.message };
        }
      })
    );

    // Filter successful responses
    const validResponses = results.filter(r => !r.error);
    if (validResponses.length === 0) {
      throw new Error('All panel models failed');
    }

    // Synthesize results (simplified for example)
    const synthesized = validResponses[0];

    return {
      responses: validResponses,
      synthesized: synthesized,
      costs: this.calculateCosts(validResponses)
    };
  }

  calculateCosts(responses) {
    // Calculate aggregated costs
    return responses.reduce((acc, response) => {
      acc.input += response.usage?.input || 0;
      acc.output += response.usage?.output || 0;
      acc.thinking += response.usage?.thinking || 0;
      acc.reasoning += response.usage?.reasoning || 0;
      acc.estimatedUSD += response.usage?.estimatedUSD || 0;
      return acc;
    }, { input: 0, output: 0, thinking: 0, reasoning: 0, estimatedUSD: 0 });
  }
}