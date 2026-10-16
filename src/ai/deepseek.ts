import type { AiErrorCode, AiMessage, AiProvider, AiResponse } from './types';

const TIMEOUT_MS = 30_000;

export class AiProviderError extends Error {
  constructor(
    public code: AiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

/**
 * DeepSeek chat-completions provider.
 *
 * The API key is supplied by the user in Settings and stored locally; it is
 * never bundled into the app. Requests use JSON mode when structured output is
 * required. Failures are raised as typed `AiProviderError`s so the caller can
 * distinguish offline / timeout / rate limit without parsing strings.
 */
export function createDeepSeekProvider(config: { apiKey: string; baseUrl: string; model: string }): AiProvider {
  const baseUrl = config.baseUrl.replace(/\/+$/, '') || 'https://api.deepseek.com';
  const model = config.model.trim() || 'deepseek-chat';

  return {
    id: 'deepseek',
    label: 'DeepSeek',
    isConfigured: () => config.apiKey.trim().length > 0,
    async complete({ messages, json, temperature = 0.2, maxTokens = 800 }): Promise<AiResponse> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey.trim()}`,
          },
          body: JSON.stringify({
            model,
            messages: messages satisfies AiMessage[],
            temperature,
            max_tokens: maxTokens,
            ...(json ? { response_format: { type: 'json_object' } } : {}),
          }),
          signal: controller.signal,
        });

        if (response.status === 429) {
          throw new AiProviderError('rate_limit', 'DeepSeek rate limit reached.');
        }
        if (response.status === 401 || response.status === 403) {
          throw new AiProviderError('not_configured', 'DeepSeek rejected the API key.');
        }
        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          throw new AiProviderError('provider_error', `DeepSeek returned ${response.status}${detail ? ` — ${detail.slice(0, 160)}` : ''}`);
        }

        const payload = (await response.json()) as {
          model?: string;
          choices?: { message?: { content?: string } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const text = payload?.choices?.[0]?.message?.content;
        if (typeof text !== 'string' || !text.trim()) {
          throw new AiProviderError('invalid_response', 'DeepSeek returned an empty response.');
        }
        return {
          text: text.trim(),
          model: payload.model ?? model,
          inputTokens: Number(payload.usage?.prompt_tokens ?? 0),
          outputTokens: Number(payload.usage?.completion_tokens ?? 0),
        };
      } catch (error) {
        if (error instanceof AiProviderError) throw error;
        if (error instanceof Error && error.name === 'AbortError') {
          throw new AiProviderError('timeout', 'DeepSeek did not answer in time.');
        }
        // fetch() rejects with a TypeError when the request cannot be made.
        throw new AiProviderError('offline', error instanceof Error ? error.message : 'Network request failed.');
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
