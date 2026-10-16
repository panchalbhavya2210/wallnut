/**
 * Affordability maths — pure and unit-testable.
 *
 * The financial engine (not the model) decides whether a purchase fits. The
 * model only explains these numbers, so the percentages it quotes are always
 * derivable from this output.
 */

export interface AffordabilityInput {
  purchase: number;
  /** Spendable balance across day-to-day accounts. */
  liquidCash: number;
  /** Expenses already projected for the rest of the period. */
  remainingProjectedSpend: number;
  /** Recurring + installment obligations falling due in the period. */
  upcomingObligations: number;
  /** Credit-card balances that reduce real availability. */
  creditCardDue: number;
  /** Money committed to goals per month. */
  savingsCommitments: number;
  /** Average monthly expenses from recent history. */
  averageMonthlyExpense: number;
}

export interface AffordabilityResult {
  /** Cash left after this purchase and all obligations above. */
  bufferBefore: number;
  bufferAfter: number;
  /** How much of the buffer the purchase consumes (0–100+). */
  bufferReducedPercent: number;
  /** Purchase as a share of average monthly expenses (0–100+). */
  shareOfMonthlySpend: number;
  verdict: 'comfortable' | 'tight' | 'not_now';
  shortfall: number;
}

function round(value: number): number {
  return Math.round(value);
}

export function computeAffordability(input: AffordabilityInput): AffordabilityResult {
  const bufferBefore = round(
    input.liquidCash - input.remainingProjectedSpend - input.upcomingObligations - input.creditCardDue - input.savingsCommitments,
  );
  const bufferAfter = round(bufferBefore - input.purchase);
  const bufferReducedPercent = bufferBefore > 0 ? round((input.purchase / bufferBefore) * 1000) / 10 : 100;
  const shareOfMonthlySpend = input.averageMonthlyExpense > 0 ? round((input.purchase / input.averageMonthlyExpense) * 1000) / 10 : 100;

  let verdict: AffordabilityResult['verdict'] = 'comfortable';
  if (bufferAfter < 0) verdict = 'not_now';
  else if (bufferReducedPercent > 35 || shareOfMonthlySpend > 60) verdict = 'tight';

  return {
    bufferBefore,
    bufferAfter,
    bufferReducedPercent,
    shareOfMonthlySpend,
    verdict,
    shortfall: bufferAfter < 0 ? Math.abs(bufferAfter) : 0,
  };
}
