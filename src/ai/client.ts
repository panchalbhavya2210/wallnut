import { useSettingsStore } from '@/stores/settings.store';

import { AiProviderError, createDeepSeekProvider } from './deepseek';
import { getCached, hashRequest, putCached } from './cache';
import { describeAiError, type AiError, type AiFeature, type AiMessage, type AiResult } from './types';

import type { AiSettings } from '@/services/settings.service';

/**
 * AI orchestrator: settings → cache → provider → validated structured result.
 *
 * Every feature goes through `runAiFeature`, which guarantees:
 *  - AI disabled / missing key / privacy=none fail with a typed error, never a
 *    crash and never a network call;
 *  - identical requests are served from SQLite while fresh;
 *  - malformed provider output is rejected instead of rendered;
 *  - usage and estimated cost are recorded for the settings screen.
 */

export function getAiSettings(): AiSettings {
  return useSettingsStore.getState().ai;
}

/** Whether a feature may run right now (used by UI to show/hide affordances). */
export function aiFeatureStatus(featureToggle: keyof AiSettings): AiError | null {
  const ai = getAiSettings();
  if (!ai.enabled) return { code: 'disabled', message: '' };
  if (!ai.apiKey.trim()) return { code: 'not_configured', message: '' };
  if (ai.privacy === 'none') return { code: 'privacy', message: '' };
  if (featureToggle !== 'enabled' && featureToggle !== 'apiKey' && featureToggle !== 'privacy' && ai[featureToggle] === false) {
    return { code: 'disabled', message: '' };
  }
  return null;
}

export function aiStatusMessage(error: AiError): string {
  return describeAiError(error);
}

/** Extracts the first JSON object from a model response (defensive). */
export function parseJsonObject<T>(text: string): T | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }
}

/** Bump when prompts/parsers change so stale cached wording is never served. */
export const AI_PROMPT_VERSION = 2;

export async function runAiFeature<T>(options: {
  feature: AiFeature;
  /** Payload identity for the cache — include everything that changes the answer. */
  cacheKey: unknown;
  ttlMs: number;
  messages: AiMessage[];
  json?: boolean;
  maxTokens?: number;
  /** Validates + normalizes the provider output. Return null to reject. */
  parse: (text: string) => T | null;
}): Promise<AiResult<T>> {
  const ai = getAiSettings();
  if (!ai.enabled) return { ok: false, error: { code: 'disabled', message: '' } };
  if (!ai.apiKey.trim()) return { ok: false, error: { code: 'not_configured', message: '' } };
  if (ai.privacy === 'none') return { ok: false, error: { code: 'privacy', message: '' } };

  const hash = hashRequest(options.feature, { v: AI_PROMPT_VERSION, payload: options.cacheKey });
  const cached = await getCached(hash);
  if (cached) {
    const parsed = safeParse(options.parse, cached);
    if (parsed !== null) return { ok: true, data: parsed, cached: true };
  }

  const provider = createDeepSeekProvider({ apiKey: ai.apiKey, baseUrl: ai.baseUrl, model: ai.model });
  let response;
  try {
    response = await provider.complete({
      messages: options.messages,
      json: options.json ?? true,
      maxTokens: options.maxTokens ?? 800,
    });
  } catch (error) {
    if (error instanceof AiProviderError) return { ok: false, error: { code: error.code, message: error.message } };
    return { ok: false, error: { code: 'provider_error', message: error instanceof Error ? error.message : 'Unknown AI error' } };
  }

  const parsed = safeParse(options.parse, response.text);
  if (parsed === null) return { ok: false, error: { code: 'invalid_response', message: response.text.slice(0, 200) } };

  await putCached({
    hash,
    feature: options.feature,
    response: response.text,
    model: response.model,
    ttlMs: options.ttlMs,
  }).catch(() => undefined);

  recordUsage(response.inputTokens, response.outputTokens);
  return { ok: true, data: parsed, cached: false };
}

function safeParse<T>(parse: (text: string) => T | null, text: string): T | null {
  try {
    return parse(text);
  } catch {
    return null;
  }
}

/** Quick settings-screen ping that verifies the key, model and network path. */
export async function testAiConnection(): Promise<AiResult<string>> {
  return runAiFeature({
    feature: 'assistant',
    cacheKey: { kind: 'connection-test', at: Date.now() },
    ttlMs: 1_000,
    maxTokens: 24,
    json: true,
    messages: [
      { role: 'system', content: 'Reply with JSON only: {"ok": true}' },
      { role: 'user', content: 'ping' },
    ],
    parse: (text) => {
      const parsed = parseJsonObject<{ ok?: boolean }>(text);
      return parsed?.ok ? 'Connected' : null;
    },
  });
}

function recordUsage(inputTokens: number, outputTokens: number): void {
  const state = useSettingsStore.getState();
  const ai = state.ai;
  const month = new Date().toISOString().slice(0, 7);
  const base = ai.usageMonth === month ? ai : { ...ai, usageCount: 0, estimatedCostUsd: 0, usageMonth: month };
  // deepseek-chat list pricing, roughly $0.27/M in · $1.10/M out.
  const cost = (inputTokens * 0.27 + outputTokens * 1.1) / 1_000_000;
  state.update('ai', {
    usageCount: base.usageCount + 1,
    estimatedCostUsd: base.estimatedCostUsd + cost,
    usageMonth: month,
  });
}
