/**
 * Tiny, deterministic arithmetic parser for the amount calculator.
 *
 * Deliberately not `eval`: the input is a user-facing expression, so a
 * tokenizer + shunting-yard keeps it safe, testable and identical on Hermes and
 * the web. Supports + − × ÷, decimal numbers and parentheses.
 */

export type CalculatorToken = number | '+' | '-' | '*' | '/' | '(' | ')' | 'u';

export interface CalculatorResult {
  ok: boolean;
  /** Major-unit result (e.g. 1250.5). */
  value: number;
  error?: string;
}

function normalise(expression: string): string {
  return expression
    .replace(/[×xX]/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/,/g, '')
    .replace(/\s+/g, '');
}

function tokenize(expression: string): CalculatorToken[] {
  const text = normalise(expression);
  if (!text) return [];
  if (text.length > 120) throw new Error('That expression is too long.');
  const tokens: CalculatorToken[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index]!;
    if (/[0-9.]/.test(char)) {
      let number = char;
      index++;
      while (index < text.length && /[0-9.]/.test(text[index]!)) {
        number += text[index]!;
        index++;
      }
      if ((number.match(/\./g) ?? []).length > 1) throw new Error('That number has more than one decimal point.');
      const value = Number(number);
      if (!Number.isFinite(value)) throw new Error('That number is not valid.');
      tokens.push(value);
      continue;
    }
    if (char === '+' || char === '-' || char === '*' || char === '/' || char === '(' || char === ')') {
      tokens.push(char);
      index++;
      continue;
    }
    throw new Error(`“${char}” is not supported here.`);
  }
  return tokens;
}

function toRpn(tokens: CalculatorToken[]): CalculatorToken[] {
  const output: CalculatorToken[] = [];
  const operators: CalculatorToken[] = [];
  const precedence: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, u: 3 };
  let previous: CalculatorToken | undefined;
  const startsOperand = (value: CalculatorToken | undefined) =>
    value === undefined || value === '(' || (typeof value === 'string' && value !== ')');

  for (const token of tokens) {
    if (typeof token === 'number') {
      output.push(token);
      previous = token;
      continue;
    }
    if (token === '(') {
      operators.push(token);
      previous = token;
      continue;
    }
    if (token === ')') {
      let found = false;
      while (operators.length > 0) {
        const top = operators.pop()!;
        if (top === '(') {
          found = true;
          break;
        }
        output.push(top);
      }
      if (!found) throw new Error('There is an unmatched closing bracket.');
      previous = token;
      continue;
    }
    if (token === '-' && startsOperand(previous)) {
      operators.push('u');
      previous = 'u';
      continue;
    }
    if (token === '+' && startsOperand(previous)) {
      // A leading plus is a no-op.
      previous = '+';
      continue;
    }
    while (operators.length > 0) {
      const top = operators[operators.length - 1]!;
      if (top === '(' || precedence[String(top)] < precedence[token]) break;
      output.push(operators.pop()!);
    }
    operators.push(token);
    previous = token;
  }

  while (operators.length > 0) {
    const top = operators.pop()!;
    if (top === '(') throw new Error('There is an unmatched opening bracket.');
    output.push(top);
  }
  return output;
}

function evaluateRpn(rpn: CalculatorToken[]): number {
  const stack: number[] = [];
  for (const token of rpn) {
    if (typeof token === 'number') {
      stack.push(token);
      continue;
    }
    if (token === 'u') {
      if (stack.length < 1) throw new Error('That expression is incomplete.');
      stack.push(-stack.pop()!);
      continue;
    }
    if (stack.length < 2) throw new Error('That expression is incomplete.');
    const right = stack.pop()!;
    const left = stack.pop()!;
    switch (token) {
      case '+':
        stack.push(left + right);
        break;
      case '-':
        stack.push(left - right);
        break;
      case '*':
        stack.push(left * right);
        break;
      case '/':
        if (right === 0) throw new Error('Cannot divide by zero.');
        stack.push(left / right);
        break;
      default:
        throw new Error('That operator is not supported.');
    }
  }
  if (stack.length !== 1) throw new Error('That expression is incomplete.');
  const result = stack[0]!;
  if (!Number.isFinite(result)) throw new Error('That result is not a finite number.');
  // Floating point guard: money is stored in minor units, so round to paise
  // before returning. This is display arithmetic, never ledger arithmetic.
  return Math.round(result * 100) / 100;
}

export function evaluateCalculator(expression: string): CalculatorResult {
  try {
    const tokens = tokenize(expression);
    if (tokens.length === 0) return { ok: false, value: 0 };
    return { ok: true, value: evaluateRpn(toRpn(tokens)) };
  } catch (error) {
    return { ok: false, value: 0, error: error instanceof Error ? error.message : 'That expression is not valid.' };
  }
}

/** Clean display string for an amount in major units (max 2 decimals). */
export function formatCalculatorAmount(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return String(Math.round(value * 100) / 100);
}
