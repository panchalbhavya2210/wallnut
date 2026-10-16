import { getAiSettings, runAiFeature } from '@/ai/client';
import { sanitizeForAi, type Json } from '@/ai/privacy';
import { parseAiCommand, type AiFinancialCommand } from './schema';
import type { QuickEntryPromptContext } from './context';
import type { AiResult } from '@/ai/types';

/**
 * The financial-command parser abstraction.
 *
 * This is the only place a model touches the quick-entry flow. It converts one
 * sentence into an `AiFinancialCommand`; it never sees the database and never
 * writes to it. DeepSeek is the only shipped implementation, but the interface
 * keeps the door open for a local parser or another provider.
 */
export interface FinancialCommandParser {
  id: string;
  label: string;
  parseFinancialCommand: (
    input: string,
    context: QuickEntryPromptContext,
  ) => Promise<AiResult<AiFinancialCommand>>;
}

const SYSTEM_PROMPT = `You convert ONE natural-language money sentence into ONE structured JSON command for Wallnut, a local-first personal finance app. You never write to a database; you only output the command.

CRITICAL RULES
- Reply with a single JSON object. No prose, no markdown, no code fences.
- Never invent values. If a required value is not clearly stated AND not present in the provided lists, set the field to null and add its field name to "missing".
- "amount" is a number in major units ("450" means 450 rupees). Copy it from the sentence; never calculate or change it.
- account / toAccount: use an EXACT name from accounts[]. If the user names something that is not in the list, set the field to null and add "account" (or "toAccount") to "missing".
- category: choose an EXACT name from categories[] only when it is a clear match; otherwise null. Never invent a category. Use income categories for income.
- person: the counterparty name exactly as written (lending, borrowing, settlement).
- participants: for shared expenses, every name the bill is split between, including "me" when the user is part of it.
- goal: an EXACT name from goals[].
- date: resolve relative dates ("yesterday", "last Friday", "on the 1st", "Oct 10") to YYYY-MM-DD in the user's local timezone using TODAY and the offset. Past unless clearly future. No date mentioned -> null.
- frequency: DAILY, WEEKLY, MONTHLY or YEARLY for recurring commands only.
- confidence: 0-1; use below 0.8 when anything is ambiguous.
- intent "UNKNOWN" when the sentence is not a money action.
- One sentence = one command.

INTENT GUIDE
- Spent / paid / bought -> CREATE_TRANSACTION with transactionType EXPENSE.
- Got / received / salary / freelance -> CREATE_INCOME (or CREATE_TRANSACTION + INCOME).
- Moved money between own accounts -> CREATE_TRANSFER (account + toAccount).
- "I lent X" / "X owes me" -> CREATE_LENDING (person).
- "I borrowed from X" -> CREATE_LOAN (person).
- "X paid me back" / "I paid X back" -> CREATE_SETTLEMENT (person).
- "split ... between ..." / "dinner 3000 split" -> CREATE_SHARED_EXPENSE with participants.
- "every month" / "subscription" / recurring bills -> CREATE_RECURRING (merchant, frequency).
- "add 5000 to <goal>" / goal savings -> CREATE_GOAL_CONTRIBUTION (goal).
- Refund / money returned -> CREATE_TRANSACTION with transactionType REFUND.

Reply with exactly this shape:
{"intent": string, "transactionType": "EXPENSE"|"INCOME"|"REFUND"|"TRANSFER"|null, "amount": number|null, "currency": string|null, "merchant": string|null, "category": string|null, "account": string|null, "toAccount": string|null, "person": string|null, "participants": string[]|null, "goal": string|null, "date": "YYYY-MM-DD"|null, "frequency": "DAILY"|"WEEKLY"|"MONTHLY"|"YEARLY"|null, "notes": string|null, "confidence": number, "missing": string[]}`;

export const deepseekCommandParser: FinancialCommandParser = {
  id: 'deepseek',
  label: 'DeepSeek',
  async parseFinancialCommand(input, context) {
    const privacy = getAiSettings().privacy;
    // The sentence is the user's own explicit input to the AI entry point and
    // must survive verbatim (amounts are data). Stored financial context still
    // goes through the privacy filter below.
    const payload = sanitizeForAi(
      { message: input.trim(), ...context } as unknown as Json,
      privacy,
      { allowMerchant: true },
    );
    return runAiFeature({
      feature: 'quick_entry',
      cacheKey: {
        message: input.trim().toLowerCase(),
        today: context.today,
        currency: context.currency,
        defaultAccount: context.defaultAccount,
        accounts: context.accounts.map((account) => account.name),
        categories: context.categories.map((category) => `${category.type}:${category.name}`),
        merchants: context.recentMerchants,
        people: context.people,
        goals: context.goals,
      },
      ttlMs: 12 * 60 * 60 * 1000,
      maxTokens: 420,
      json: true,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(payload) },
      ],
      parse: (text) => {
        const parsed = parseAiCommand(text, { today: context.today, currency: context.currency });
        return parsed.ok ? parsed.command : null;
      },
    });
  },
};

/** The parser used by the app today; swap here to change providers. */
export function getFinancialCommandParser(): FinancialCommandParser {
  return deepseekCommandParser;
}
