/**
 * AI provider abstraction.
 *
 * Wallnut ships DeepSeek only, but every feature talks to this interface so
 * another provider (OpenAI, local model, …) can be added without touching the
 * features. The financial engine calculates; the provider only explains.
 */

export type AiFeature = 'categorize' | 'insight' | 'assistant' | 'affordability' | 'monthly_review' | 'quick_entry';

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiResponse {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface AiProvider {
  id: string;
  label: string;
  isConfigured: () => boolean;
  complete: (request: {
    messages: AiMessage[];
    /** Ask the provider for a JSON object response. */
    json?: boolean;
    temperature?: number;
    maxTokens?: number;
  }) => Promise<AiResponse>;
}

export type AiErrorCode =
  | 'disabled'
  | 'not_configured'
  | 'privacy'
  | 'offline'
  | 'timeout'
  | 'rate_limit'
  | 'invalid_response'
  | 'provider_error';

export interface AiError {
  code: AiErrorCode;
  message: string;
}

export type AiResult<T> = { ok: true; data: T; cached: boolean } | { ok: false; error: AiError };

/** Human-readable failure text used across the UI. */
export function describeAiError(error: AiError): string {
  switch (error.code) {
    case 'disabled':
      return 'AI is turned off in Settings → AI & Automation.';
    case 'not_configured':
      return 'Add your DeepSeek API key in Settings → AI & Automation.';
    case 'privacy':
      return 'Your AI privacy setting blocks this analysis.';
    case 'offline':
      return "AI insights aren't available right now — check your connection. Your financial data is still fully available.";
    case 'timeout':
      return 'DeepSeek took too long to answer. Your financial data is still fully available.';
    case 'rate_limit':
      return 'DeepSeek is rate limiting requests. Try again in a moment.';
    case 'invalid_response':
      return 'DeepSeek returned an unexpected response. Your financial data is unaffected.';
    default:
      return 'AI is unavailable right now. Your financial data is still fully available.';
  }
}
