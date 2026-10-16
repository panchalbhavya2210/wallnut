import { getAiSettings } from '@/ai/client';

import { buildQuickEntryPromptContext, getRecentMerchantNames, loadQuickEntryLocalData, type QuickEntryLocalData } from './context';
import { executeQuickEntry, executeQuickEntryBatch, type ExecutionResult, type QuickEntryBatchOutcome } from './execute';
import { getFinancialCommandParser } from './provider';
import {
  answerCommand,
  buildQuestions,
  commandAmountMinor,
  resolveQuickEntry,
  unresolvedFields,
  type QuestionAnswer,
  type QuickEntryQuestion,
  type ResolvedQuickEntry,
} from './resolve';
import {
  confirmationDecision,
  type AiFinancialCommand,
  type AiMissingField,
  type ConfirmationDecision,
} from './schema';
import type { AiResult } from '@/ai/types';

/**
 * Quick Entry orchestrator — the single API the UI uses.
 *
 *   sentence → parser (DeepSeek) → strict command → local resolution →
 *   questions for anything missing → confirmation → existing services.
 *
 * `applyAnswer`/`skipQuestion` never call the model again: once a command is
 * parsed, every correction is local.
 */

export interface QuickEntryAnalysis {
  command: AiFinancialCommand;
  local: QuickEntryLocalData;
  resolved: ResolvedQuickEntry;
  missing: AiMissingField[];
  questions: QuickEntryQuestion[];
  decision: ConfirmationDecision;
  amountMinor: number | null;
  /** True when the parser produced the command from cache. */
  cached: boolean;
}

export async function analyzeQuickEntry(
  input: string,
  options: { typeHint?: 'expense' | 'income' | 'transfer' } = {},
): Promise<AiResult<QuickEntryAnalysis>> {
  const ai = getAiSettings();
  if (!ai.quickEntry) return { ok: false, error: { code: 'disabled', message: '' } };

  const local = await loadQuickEntryLocalData();
  const recentMerchants = ai.shareContext ? await getRecentMerchantNames() : [];
  const context = buildQuickEntryPromptContext(local, {
    shareContext: ai.shareContext,
    recentMerchants,
  });

  const parser = getFinancialCommandParser();
  const result = await parser.parseFinancialCommand(input, context);
  if (!result.ok) return result;
  const command = applyTypeHint(result.data, options.typeHint);
  return { ok: true, data: recompute(command, local, result.cached), cached: result.cached };
}

/**
 * Widget quick-add buttons pre-select a type. The hint only refines a parsed
 * transaction command; it never overrides debt/settlement/recurring intents.
 */
export function applyTypeHint(
  command: AiFinancialCommand,
  hint?: 'expense' | 'income' | 'transfer',
): AiFinancialCommand {
  if (!hint || hint === 'expense') return command;
  if (hint === 'income' && (command.intent === 'CREATE_TRANSACTION' || command.intent === 'CREATE_INCOME')) {
    return { ...command, intent: 'CREATE_INCOME', transactionType: 'INCOME' };
  }
  if (hint === 'transfer' && (command.intent === 'CREATE_TRANSACTION' || command.intent === 'CREATE_TRANSFER')) {
    return { ...command, intent: 'CREATE_TRANSFER', transactionType: 'TRANSFER' };
  }
  return command;
}

function recompute(command: AiFinancialCommand, local: QuickEntryLocalData, cached: boolean): QuickEntryAnalysis {
  const resolved = resolveQuickEntry(command, local);
  const missing = unresolvedFields(command, resolved, local);
  const amountMinor = commandAmountMinor(command);
  return {
    command,
    local,
    resolved,
    missing,
    questions: buildQuestions(command, resolved, local, missing),
    decision: confirmationDecision({
      mode: getAiSettings().confirmationMode,
      command,
      amountMinor,
    }),
    amountMinor,
    cached,
  };
}

/** Applies a chip/free-text answer and re-resolves locally. */
export function applyAnswer(
  analysis: QuickEntryAnalysis,
  question: QuickEntryQuestion,
  answer: QuestionAnswer,
): QuickEntryAnalysis {
  return recompute(answerCommand(analysis.command, question, answer), analysis.local, false);
}

/**
 * Inline edits from the confirmation card (date, category, account…). Purely
 * local — the model is never called again once a command has been parsed.
 */
export function applyCommandPatch(
  analysis: QuickEntryAnalysis,
  patch: Partial<AiFinancialCommand>,
): QuickEntryAnalysis {
  return recompute({ ...analysis.command, ...patch }, analysis.local, false);
}

/**
 * Conscious skip for optional fields ("Track only — no cash movement",
 * "Leave uncategorised"). Clears the field so it can never be guessed.
 */
export function skipQuestion(analysis: QuickEntryAnalysis, question: QuickEntryQuestion): QuickEntryAnalysis {
  if (question.field === 'account') {
    return recompute({ ...analysis.command, account: null }, analysis.local, false);
  }
  if (question.field === 'category') {
    return recompute({ ...analysis.command, category: null }, analysis.local, false);
  }
  return analysis;
}

/** Executes through the existing financial services. */
export async function confirmQuickEntry(analysis: QuickEntryAnalysis): Promise<ExecutionResult> {
  return executeQuickEntry(analysis.resolved, analysis.local);
}

/* ------------------------------- Batch intake ------------------------------ */

/** One verification row: a full analysis the user can still edit locally. */
export interface QuickEntryBatchItem {
  id: string;
  analysis: QuickEntryAnalysis;
}

export interface QuickEntryBatchAnalysis {
  local: QuickEntryLocalData;
  items: QuickEntryBatchItem[];
  /** Fragments the parser refused to batch — they need the single-entry flow. */
  excluded: string[];
  cached: boolean;
}

/**
 * Bulk quick entry: one message in, a reviewed list of commands out. Nothing
 * is written here — the verification screen edits each row (all local, no
 * second model call) and only "Save all" reaches the financial services.
 */
export async function analyzeQuickEntryBatch(
  input: string,
  options: { typeHint?: 'expense' | 'income' | 'transfer' } = {},
): Promise<AiResult<QuickEntryBatchAnalysis>> {
  const ai = getAiSettings();
  if (!ai.quickEntry) return { ok: false, error: { code: 'disabled', message: '' } };

  const local = await loadQuickEntryLocalData();
  const recentMerchants = ai.shareContext ? await getRecentMerchantNames() : [];
  const context = buildQuickEntryPromptContext(local, {
    shareContext: ai.shareContext,
    recentMerchants,
  });

  const parser = getFinancialCommandParser();
  const result = await parser.parseFinancialCommands(input, context);
  if (!result.ok) return result;

  const items: QuickEntryBatchItem[] = result.data.commands.map((command, index) => ({
    id: `cmd-${index}`,
    analysis: recompute(applyTypeHint(command, options.typeHint), local, result.cached),
  }));
  return {
    ok: true,
    data: { local, items, excluded: result.data.excluded, cached: result.cached },
    cached: result.cached,
  };
}

/** Edits one verification row locally (date, category, account, amount, name). */
export function patchBatchItem(
  batch: QuickEntryBatchAnalysis,
  itemId: string,
  patch: Partial<AiFinancialCommand>,
): QuickEntryBatchAnalysis {
  return {
    ...batch,
    items: batch.items.map((item) =>
      item.id === itemId ? { ...item, analysis: applyCommandPatch(item.analysis, patch) } : item,
    ),
  };
}

export function removeBatchItem(batch: QuickEntryBatchAnalysis, itemId: string): QuickEntryBatchAnalysis {
  return { ...batch, items: batch.items.filter((item) => item.id !== itemId) };
}

/** Saves every reviewed row through the existing services, in order. */
export async function confirmQuickEntryBatch(batch: QuickEntryBatchAnalysis): Promise<QuickEntryBatchOutcome> {
  return executeQuickEntryBatch(
    batch.items.map((item) => ({ id: item.id, resolved: item.analysis.resolved })),
    batch.local,
  );
}

export type {
  AiFinancialCommand,
  AiMissingField,
  ConfirmationDecision,
  ExecutionResult,
  QuestionAnswer,
  QuickEntryBatchOutcome,
  QuickEntryQuestion,
  ResolvedQuickEntry,
};
