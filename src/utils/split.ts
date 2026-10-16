/**
 * Shared-expense maths — pure, unit-tested, no database.
 *
 * Three concerns live here:
 *
 *  1. SPLIT ALLOCATIONS: turning a total + split type into one amount per
 *     participant. All money is integer minor units; remainders are handed out
 *     by largest fractional part so the shares always add up exactly to the
 *     total (no lost or invented paise).
 *
 *  2. BALANCES: trips are paid for by several people at different times. Every
 *     expense records who actually paid (one or more payers) and each person's
 *     share. Balances are then derived — never stored:
 *       member balance = Σ paid − Σ share  (+/− settlements)
 *     A positive balance means "is owed money", negative means "owes money".
 *     The user's per-person positions (for Money Owed) use proportional
 *     attribution, normalised so they always sum to the exact cash delta.
 *
 *  3. SETTLEMENT SUGGESTIONS: the classic greedy "largest debtor pays largest
 *     creditor" simplification, so a trip ends with a few transfers, not a web.
 *
 * The accounting rule of the shared-expense system is encoded in
 * `planSharedLedger`:
 *   You pay ₹20,000 of a ₹30,000 villa, your share is ₹7,500 →
 *     expense  ₹7,500  (your personal spending)
 *     lending  ₹12,500 (cash out, receivable — never an expense)
 *   Someone else covers your share → no cash row; only a payable.
 */

export type SharedSplitType = 'equal' | 'exact' | 'percentage' | 'shares';

export interface SplitParticipantInput {
  /** 'self' for the user, or a person id. */
  key: string;
  /**
   * Raw user input:
   *   exact      → minor units
   *   percentage → basis points (50% = 5000)
   *   shares     → share count
   *   equal      → ignored
   */
  value?: number | null;
}

export interface SplitAllocation {
  key: string;
  /** Minor units, always >= 0. */
  amount: number;
}

const SELF_KEY = 'self';

export function memberKey(personId: string | null): string {
  return personId ?? SELF_KEY;
}

function allocateByWeights(total: number, entries: { key: string; weight: number }[]): SplitAllocation[] {
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) throw new Error('Every participant needs a positive weight.');

  const exact = entries.map((entry) => {
    const value = (total * entry.weight) / totalWeight;
    const floor = Math.floor(value);
    return { key: entry.key, floor, fraction: value - floor };
  });

  let remainder = total - exact.reduce((sum, entry) => sum + entry.floor, 0);

  // Largest fractional part first; ties fall back to input order.
  const ranked = exact
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  const bonus = new Set<number>();
  for (let index = 0; index < ranked.length && remainder > 0; index++) {
    bonus.add(ranked[index]!.index);
    remainder--;
  }

  return exact.map((entry, index) => ({ key: entry.key, amount: entry.floor + (bonus.has(index) ? 1 : 0) }));
}

/**
 * Splits `total` (minor units) across participants.
 * Throws with a human-readable message when the inputs cannot balance.
 */
export function computeSplit(
  total: number,
  type: SharedSplitType,
  participants: SplitParticipantInput[],
): SplitAllocation[] {
  const roundedTotal = Math.round(total);
  if (!Number.isFinite(roundedTotal) || roundedTotal <= 0) {
    throw new Error('Enter an amount greater than zero.');
  }
  if (participants.length < 2) {
    throw new Error('A shared expense needs at least two people.');
  }
  const keys = new Set(participants.map((participant) => participant.key));
  if (keys.size !== participants.length) {
    throw new Error('Each person can appear only once in a split.');
  }

  switch (type) {
    case 'equal':
      return allocateByWeights(
        roundedTotal,
        participants.map((participant) => ({ key: participant.key, weight: 1 })),
      );

    case 'exact': {
      const amounts = participants.map((participant) => Math.round(participant.value ?? 0));
      if (amounts.some((amount) => amount < 0)) throw new Error('Shares cannot be negative.');
      const sum = amounts.reduce((acc, amount) => acc + amount, 0);
      if (sum !== roundedTotal) {
        throw new Error(
          sum < roundedTotal
            ? 'Exact amounts are less than the total — distribute the rest.'
            : 'Exact amounts are more than the total.',
        );
      }
      return participants.map((participant, index) => ({ key: participant.key, amount: amounts[index]! }));
    }

    case 'percentage': {
      const basisPoints = participants.map((participant) => Math.round(participant.value ?? 0));
      if (basisPoints.some((value) => value < 0)) throw new Error('Percentages cannot be negative.');
      const sum = basisPoints.reduce((acc, value) => acc + value, 0);
      if (sum !== 10_000) throw new Error('Percentages must add up to 100%.');
      return allocateByWeights(
        roundedTotal,
        participants.map((participant, index) => ({ key: participant.key, weight: basisPoints[index]! })),
      );
    }

    case 'shares': {
      const weights = participants.map((participant) => Math.round(participant.value ?? 0));
      if (weights.some((weight) => weight <= 0)) throw new Error('Every participant needs at least one share.');
      return allocateByWeights(
        roundedTotal,
        participants.map((participant, index) => ({ key: participant.key, weight: weights[index]! })),
      );
    }

    default:
      throw new Error('Choose how to split this expense.');
  }
}

/* -------------------------------- Balances --------------------------------- */

export interface ExpenseLedgerRecord {
  /** Everyone who fronted money for this expense. `personId: null` = the user. */
  payers: { personId: string | null; amount: number }[];
  /** Each participant's share; shares sum to the bill. `personId: null` = the user. */
  participants: { personId: string | null; share: number }[];
}

export interface SettlementRecord {
  /** Who sent the money. `null` = the user. */
  fromPersonId: string | null;
  /** Who received it. `null` = the user. */
  toPersonId: string | null;
  amount: number;
}

export interface PersonBalance {
  personId: string;
  /** Net position: positive = they owe you (kept for the existing UI shape). */
  theyOwe: number;
  /** Negative side of the net (kept for the existing UI shape). */
  youOwe: number;
  /** theyOwe − youOwe; positive = they owe you. */
  net: number;
}

/**
 * The user's net position with every other person for ONE expense.
 *
 * Attribution follows Splitwise: each payer's money is spread over the
 * participants in proportion to their shares, so a person who paid more than
 * they consumed accumulates a credit, and someone who paid less accumulates a
 * debt. The per-person results are normalised against the user's exact cash
 * delta (`paid − share`) so rounding can never drift from the ledger mirror.
 */
export function expenseUserNets(expense: ExpenseLedgerRecord): Map<string, number> {
  const participants = expense.participants.map((participant) => ({
    key: memberKey(participant.personId),
    share: Math.round(participant.share),
  }));
  const shareOf = new Map(participants.map((participant) => [participant.key, participant.share]));

  const selfShare = shareOf.get(SELF_KEY) ?? 0;
  const selfPaid = expense.payers
    .filter((payer) => payer.personId === null)
    .reduce((sum, payer) => sum + Math.round(payer.amount), 0);

  // payerKey → participantKey → what that participant owes that payer.
  const allocations = new Map<string, Map<string, number>>();
  for (const payer of expense.payers) {
    const paid = Math.round(payer.amount);
    if (paid <= 0 || participants.length === 0) continue;
    const allocation = allocateByWeights(
      paid,
      participants.map((participant) => ({ key: participant.key, weight: Math.max(0, participant.share) })),
    );
    allocations.set(
      memberKey(payer.personId),
      new Map(allocation.map((entry) => [entry.key, entry.amount])),
    );
  }

  const others = new Set<string>();
  for (const participant of expense.participants) if (participant.personId) others.add(participant.personId);
  for (const payer of expense.payers) if (payer.personId) others.add(payer.personId);

  const nets = new Map<string, number>();
  let total = 0;
  for (const personId of others) {
    // If they paid, the user's slice of that payment is what the user owes them.
    const userOwes = allocations.get(personId)?.get(SELF_KEY) ?? 0;
    // If the user paid, their slice is what they owe the user.
    const owesUser = allocations.get(SELF_KEY)?.get(personId) ?? 0;
    const net = owesUser - userOwes;
    if (net !== 0) nets.set(personId, net);
    total += net;
  }

  // Normalise to the exact cash delta so Money Owed can never disagree with
  // the ledger mirror by a paisa. The adjustment lands on the largest position.
  const target = selfPaid - selfShare;
  const diff = target - total;
  if (diff !== 0 && others.size > 0) {
    let chosen: string | null = null;
    for (const [personId, net] of nets) {
      if (chosen === null || Math.abs(net) > Math.abs(nets.get(chosen) ?? 0)) chosen = personId;
    }
    if (chosen === null) {
      // Every net cancelled exactly; put the delta on the largest share.
      let best: string | null = null;
      let bestShare = -1;
      for (const participant of expense.participants) {
        if (!participant.personId) continue;
        if (participant.share > bestShare) {
          bestShare = participant.share;
          best = participant.personId;
        }
      }
      if (best) nets.set(best, (nets.get(best) ?? 0) + diff);
    } else {
      nets.set(chosen, (nets.get(chosen) ?? 0) + diff);
    }
  }

  return nets;
}

/** Net position with every person across all expenses and settlements. */
export function userPairBalances(
  expenses: ExpenseLedgerRecord[],
  settlements: SettlementRecord[] = [],
): Map<string, number> {
  const nets = new Map<string, number>();
  const add = (personId: string, delta: number) => nets.set(personId, (nets.get(personId) ?? 0) + delta);

  for (const expense of expenses) {
    for (const [personId, net] of expenseUserNets(expense)) add(personId, net);
  }

  for (const settlement of settlements) {
    const amount = Math.round(settlement.amount);
    if (amount <= 0) continue;
    if (settlement.fromPersonId === null && settlement.toPersonId !== null) {
      // You paid them: your payable shrinks, so the net moves in their favour.
      add(settlement.toPersonId, amount);
    } else if (settlement.toPersonId === null && settlement.fromPersonId !== null) {
      // They paid you: your receivable shrinks.
      add(settlement.fromPersonId, -amount);
    }
  }

  return nets;
}

/** Same as `userPairBalances`, reshaped into the UI's theyOwe/youOwe form. */
export function computePersonBalances(
  expenses: ExpenseLedgerRecord[],
  settlements: SettlementRecord[] = [],
): Map<string, PersonBalance> {
  const balances = new Map<string, PersonBalance>();
  for (const [personId, net] of userPairBalances(expenses, settlements)) {
    if (net === 0) continue;
    balances.set(personId, {
      personId,
      theyOwe: Math.max(0, net),
      youOwe: Math.max(0, -net),
      net,
    });
  }
  return balances;
}

/**
 * Exact balances for every member of a trip (including 'self'): what each
 * person has paid minus what they have consumed, adjusted by settlements.
 * Positive = they should receive money; negative = they should pay.
 */
export function computeMemberBalances(
  expenses: ExpenseLedgerRecord[],
  settlements: SettlementRecord[] = [],
): Map<string, number> {
  const balances = new Map<string, number>();
  const add = (key: string, delta: number) => balances.set(key, (balances.get(key) ?? 0) + delta);

  for (const expense of expenses) {
    for (const payer of expense.payers) {
      const amount = Math.round(payer.amount);
      if (amount !== 0) add(memberKey(payer.personId), amount);
    }
    for (const participant of expense.participants) {
      const share = Math.round(participant.share);
      if (share !== 0) add(memberKey(participant.personId), -share);
    }
  }

  for (const settlement of settlements) {
    const amount = Math.round(settlement.amount);
    if (amount <= 0) continue;
    const from = memberKey(settlement.fromPersonId);
    const to = memberKey(settlement.toPersonId);
    if (from === to) continue;
    add(from, amount);
    add(to, -amount);
  }

  return balances;
}

export interface BalanceTotals {
  theyOweYou: number;
  youOwe: number;
  net: number;
}

/** Net totals across people: what you are owed minus what you owe. */
export function balanceTotals(balances: Iterable<PersonBalance>): BalanceTotals {
  let theyOweYou = 0;
  let youOwe = 0;
  for (const balance of balances) {
    if (balance.net > 0) theyOweYou += balance.net;
    else if (balance.net < 0) youOwe += -balance.net;
  }
  return { theyOweYou, youOwe, net: theyOweYou - youOwe };
}

/* ------------------------- Settlement suggestions --------------------------- */

export interface SettlementSuggestion {
  fromKey: string;
  toKey: string;
  amount: number;
}

/**
 * Greedy simplification: repeatedly match the largest debtor with the largest
 * creditor. Produces at most n−1 transfers and is the same idea Splitwise uses
 * ("settle up" lists only what still needs to move).
 */
export function suggestSettlements(balances: Iterable<[string, number]>): SettlementSuggestion[] {
  const entries = Array.from(balances)
    .map(([key, net]) => ({ key, net: Math.round(net) }))
    .filter((entry) => entry.net !== 0);

  const debtors = entries.filter((entry) => entry.net < 0).sort((a, b) => a.net - b.net);
  const creditors = entries.filter((entry) => entry.net > 0).sort((a, b) => b.net - a.net);

  const suggestions: SettlementSuggestion[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;
  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex]!;
    const creditor = creditors[creditorIndex]!;
    const amount = Math.min(-debtor.net, creditor.net);
    if (amount > 0) {
      suggestions.push({ fromKey: debtor.key, toKey: creditor.key, amount });
      debtor.net += amount;
      creditor.net -= amount;
    }
    if (debtor.net === 0) debtorIndex++;
    if (creditor.net === 0) creditorIndex++;
  }
  return suggestions;
}

/* ------------------------------- Ledger plan -------------------------------- */

export interface SharedItemSummary {
  /** Sum of all item amounts, minor units. */
  total: number;
  /** A short title derived from the items ("Train travel +2 more"). */
  title: string;
}

/**
 * Turns dynamic line items into the batch total and a display title. The total
 * is all the accounting ever uses; the title is only for lists and ledgers.
 */
export function summarizeSharedItems(items: { name: string; amount: number }[]): SharedItemSummary {
  const total = items.reduce((sum, item) => sum + Math.max(0, Math.round(item.amount)), 0);
  const named = items.map((item) => item.name.trim()).filter(Boolean);
  if (named.length === 0) return { total, title: 'Shared expense' };
  if (named.length === 1) return { total, title: named[0]! };
  return { total, title: `${named[0]} +${named.length - 1} more` };
}

export interface SharedLedgerPlan {
  /** True when cash actually leaves one of the user's accounts. */
  userPaid: boolean;
  /** Cash that left for the user's OWN consumption → a real `expense` row. */
  expenseAmount: number;
  /** What the user paid beyond their share → a `lending` row (receivable). */
  receivableAmount: number;
  /** The part of the user's share someone else fronted → a payable. */
  payableAmount: number;
}

/**
 * The ledger consequence of a (possibly multi-payer) shared expense. Keeping it
 * pure means the accounting rule — the full bill is never personal spending —
 * is unit-testable without a database.
 */
export function planSharedLedger(input: { selfPaid: number; selfShare: number }): SharedLedgerPlan {
  const selfPaid = Math.max(0, Math.round(input.selfPaid));
  const selfShare = Math.max(0, Math.round(input.selfShare));
  return {
    userPaid: selfPaid > 0,
    expenseAmount: Math.min(selfPaid, selfShare),
    receivableAmount: Math.max(0, selfPaid - selfShare),
    payableAmount: Math.max(0, selfShare - selfPaid),
  };
}
