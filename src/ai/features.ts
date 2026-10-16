import { getAiSettings, parseJsonObject, runAiFeature } from './client';
import { toMajor, type AiFinanceContext } from './context';
import { sanitizeForAi, type Json } from './privacy';
import type { AiResult } from './types';

/**
 * The five MVP AI capabilities. Every function takes engine-calculated numbers
 * and asks DeepSeek only for language: a category choice, an explanation or a
 * summary. Output is validated against local data before it ever reaches UI.
 */

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const FOCUS_VALUES = ['spending', 'budgets', 'subscriptions', 'savings', 'debt', 'recurring'] as const;
export type AiFocus = (typeof FOCUS_VALUES)[number] | null;

function parseFocus(value: unknown): AiFocus {
  return typeof value === 'string' && (FOCUS_VALUES as readonly string[]).includes(value) ? (value as AiFocus) : null;
}

/* --------------------------- 1. Categorization ----------------------------- */

export interface CategorySuggestion {
  categoryId: string;
  categoryName: string;
  path: string | null;
  confidence: number;
}

export async function suggestCategory(input: {
  merchant: string;
  amountMinor: number;
  type: 'expense' | 'income';
  categories: { id: string; name: string; parentName?: string | null }[];
}): Promise<AiResult<CategorySuggestion>> {
  const privacy = getAiSettings().privacy;
  const payload = sanitizeForAi(
    {
      merchant: input.merchant.trim(),
      amount: toMajor(input.amountMinor),
      type: input.type,
      categories: input.categories.map((category) => ({
        id: category.id,
        name: category.parentName ? `${category.parentName} › ${category.name}` : category.name,
      })),
    },
    privacy,
    // The merchant is required for categorization; the user opted in.
    { allowMerchant: true },
  );

  return runAiFeature({
    feature: 'categorize',
    cacheKey: { merchant: input.merchant.trim().toLowerCase(), type: input.type },
    ttlMs: 30 * 24 * 60 * 60 * 1000,
    maxTokens: 120,
    json: true,
    messages: [
      {
        role: 'system',
        content:
          'You categorize personal-finance transactions into the user\'s existing categories. Reply with JSON only, in the form {"categoryId": string, "confidence": number}. The categoryId MUST be one of the provided ids — never invent a category. Choose the closest match when unsure and use a low confidence (0–1).',
      },
      { role: 'user', content: JSON.stringify(payload) },
    ],
    parse: (text) => {
      const parsed = parseJsonObject<{ categoryId?: string; confidence?: number }>(text);
      if (!parsed?.categoryId) return null;
      const match = input.categories.find((category) => category.id === parsed.categoryId);
      if (!match) return null;
      return {
        categoryId: match.id,
        categoryName: match.name,
        path: match.parentName ?? null,
        confidence: clamp(Number(parsed.confidence ?? 0.5), 0, 1),
      };
    },
  });
}

/* ----------------------------- 2. Insights --------------------------------- */

export interface AiInsight {
  title: string;
  summary: string;
  severity: 'info' | 'positive' | 'warning';
  focus: AiFocus;
}

export async function generateInsight(context: AiFinanceContext): Promise<AiResult<AiInsight>> {
  const privacy = getAiSettings().privacy;
  const payload = sanitizeForAi(context as unknown as Json, privacy);
  return runAiFeature({
    feature: 'insight',
    cacheKey: { period: context.period, payload },
    ttlMs: 4 * 60 * 60 * 1000,
    maxTokens: 220,
    json: true,
    messages: [
      {
        role: 'system',
        content:
          'You are Wallnut\'s financial analyst. Using ONLY the numbers in the JSON (never invent or recalculate), write one product-quality observation about the user\'s month. Lead with the most remarkable number, quantify it, and give it meaning in at most two sentences. No filler, no "hello", no advice. Money: ₹ with Indian grouping, decimals only when non-zero. Reply with JSON only: {"title": string (max 6 words), "summary": string (max 45 words), "severity": "info"|"positive"|"warning", "focus": "spending"|"budgets"|"subscriptions"|"savings"|"debt"|"recurring"|null}.',
      },
      { role: 'user', content: JSON.stringify(payload) },
    ],
    parse: (text) => {
      const parsed = parseJsonObject<{ title?: string; summary?: string; severity?: string; focus?: string }>(text);
      if (!parsed?.title || !parsed.summary) return null;
      const severity = parsed.severity === 'positive' || parsed.severity === 'warning' ? parsed.severity : 'info';
      return { title: parsed.title.slice(0, 80), summary: parsed.summary.slice(0, 400), severity, focus: parseFocus(parsed.focus) };
    },
  });
}

/* ----------------------------- 3. Assistant -------------------------------- */

export interface AssistantAnswer {
  answer: string;
  focus: AiFocus;
}

export async function explainAssistant(input: {
  question: string;
  fact: string;
  data: Json;
  context: AiFinanceContext;
}): Promise<AiResult<AssistantAnswer>> {
  const privacy = getAiSettings().privacy;
  const payload = sanitizeForAi(
    { question: input.question, answer: input.fact, data: input.data, snapshot: input.context as unknown as Json },
    privacy,
    // Merchant/category names are required to answer the specific question.
    { allowMerchant: true },
  );
  return runAiFeature({
    feature: 'assistant',
    cacheKey: { question: input.question.trim().toLowerCase(), data: input.data },
    ttlMs: 30 * 60 * 1000,
    maxTokens: 260,
    json: true,
    messages: [
      {
        role: 'system',
        content:
          'You are Wallnut\'s financial assistant. The JSON holds the user\'s question, a ledger-calculated fact and its source data. Write the answer the user actually wants: the first sentence answers directly with the exact number(s); then at most one sentence of comparison or context that makes it useful; optionally one short observation. Do not restate the fact word-for-word, do not open with "Based on your data", and do not pad. If the data cannot answer the question, say in one sentence exactly what is missing. If the user asks whether spending was necessary/required, give a qualitative split using the categories (rent, bills, groceries are usually essential; dining, shopping, subscriptions are usually discretionary) and label it as a general classification — never as advice. Money: use ₹ with Indian grouping, no space after ₹, decimals only when non-zero. Max 70 words. Reply with JSON only: {"answer": string, "focus": "spending"|"budgets"|"subscriptions"|"savings"|"debt"|"recurring"|null}.',
      },
      { role: 'user', content: JSON.stringify(payload) },
    ],
    parse: (text) => {
      const parsed = parseJsonObject<{ answer?: string; focus?: string }>(text);
      if (!parsed?.answer) return null;
      return { answer: parsed.answer.slice(0, 700), focus: parseFocus(parsed.focus) };
    },
  });
}

/* --------------------------- 4. Affordability ------------------------------ */

export interface AffordabilityExplanation {
  answer: string;
}

export async function explainAffordability(input: {
  item: string;
  purchaseMajor: number;
  result: Json;
  context: AiFinanceContext;
}): Promise<AiResult<AffordabilityExplanation>> {
  const privacy = getAiSettings().privacy;
  const payload = sanitizeForAi(
    { item: input.item, purchase: input.purchaseMajor, calculation: input.result, snapshot: input.context as unknown as Json },
    privacy,
  );
  return runAiFeature({
    feature: 'affordability',
    cacheKey: { item: input.item.toLowerCase(), purchase: input.purchaseMajor, result: input.result },
    ttlMs: 60 * 60 * 1000,
    maxTokens: 220,
    json: true,
    messages: [
      {
        role: 'system',
        content:
          'You explain an affordability calculation for Wallnut. The engine already decided the numbers; explain them in max 70 words. Use ONLY values from the JSON. Mention the buffer change and any pace/budget pressure. Never tell the user what to do; say "Based on your Wallnut data…". Reply with JSON only: {"answer": string}.',
      },
      { role: 'user', content: JSON.stringify(payload) },
    ],
    parse: (text) => {
      const parsed = parseJsonObject<{ answer?: string }>(text);
      return parsed?.answer ? { answer: parsed.answer.slice(0, 600) } : null;
    },
  });
}

/* -------------------------- 5. Monthly review ------------------------------ */

export interface MonthlyReviewSummary {
  headline: string;
  changed: { label: string; detail: string }[];
  goingWell: string[];
  watch: string[];
}

export async function generateMonthlyReview(context: AiFinanceContext): Promise<AiResult<MonthlyReviewSummary>> {
  const privacy = getAiSettings().privacy;
  const payload = sanitizeForAi(context as unknown as Json, privacy);
  return runAiFeature({
    feature: 'monthly_review',
    cacheKey: { period: context.period, payload },
    ttlMs: 24 * 60 * 60 * 1000,
    maxTokens: 480,
    json: true,
    messages: [
      {
        role: 'system',
        content:
          'You write Wallnut\'s monthly review. Use ONLY the numbers in the JSON. Reply with JSON only: {"headline": string (max 12 words), "changed": [{"label": string, "detail": string}] (max 3; category or metric name + direction/percent), "goingWell": string[] (max 2), "watch": string[] (max 2)}. Be factual, never judgmental, never give financial advice.',
      },
      { role: 'user', content: JSON.stringify(payload) },
    ],
    parse: (text) => {
      const parsed = parseJsonObject<{ headline?: string; changed?: { label?: string; detail?: string }[]; goingWell?: string[]; watch?: string[] }>(text);
      if (!parsed?.headline) return null;
      return {
        headline: parsed.headline.slice(0, 160),
        changed: (parsed.changed ?? [])
          .filter((entry) => entry?.label)
          .slice(0, 3)
          .map((entry) => ({ label: String(entry.label).slice(0, 60), detail: String(entry.detail ?? '').slice(0, 120) })),
        goingWell: (parsed.goingWell ?? []).slice(0, 2).map((entry) => String(entry).slice(0, 160)),
        watch: (parsed.watch ?? []).slice(0, 2).map((entry) => String(entry).slice(0, 160)),
      };
    },
  });
}
