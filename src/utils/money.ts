/**
 * Money utilities.
 *
 * All amounts in Wallnut are stored and computed as INTEGER minor units
 * (paise for INR). 450.50 is stored as 45050. Floats never touch the ledger.
 * Formatting is deterministic and implemented manually so output is identical
 * on every platform (no Intl dependency).
 */

export type CurrencyCode = 'INR' | 'USD' | 'EUR' | 'GBP' | 'JPY' | 'AED' | 'SGD' | 'AUD' | 'CAD' | 'CHF';

export type GroupingStyle = 'indian' | 'western';

export interface CurrencyInfo {
  code: CurrencyCode;
  symbol: string;
  name: string;
  /** Default grouping for the currency. */
  grouping: GroupingStyle;
  /** Fraction digits (JPY has none). */
  decimals: number;
}

export const CURRENCIES: Record<CurrencyCode, CurrencyInfo> = {
  INR: { code: 'INR', symbol: '₹', name: 'Indian Rupee', grouping: 'indian', decimals: 2 },
  USD: { code: 'USD', symbol: '$', name: 'US Dollar', grouping: 'western', decimals: 2 },
  EUR: { code: 'EUR', symbol: '€', name: 'Euro', grouping: 'western', decimals: 2 },
  GBP: { code: 'GBP', symbol: '£', name: 'British Pound', grouping: 'western', decimals: 2 },
  JPY: { code: 'JPY', symbol: '¥', name: 'Japanese Yen', grouping: 'western', decimals: 0 },
  AED: { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham', grouping: 'western', decimals: 2 },
  SGD: { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar', grouping: 'western', decimals: 2 },
  AUD: { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', grouping: 'western', decimals: 2 },
  CAD: { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar', grouping: 'western', decimals: 2 },
  CHF: { code: 'CHF', symbol: 'CHF ', name: 'Swiss Franc', grouping: 'western', decimals: 2 },
};

export function currencyInfo(code: string): CurrencyInfo {
  return CURRENCIES[code as CurrencyCode] ?? CURRENCIES.INR;
}

/** Converts a display ("major") amount like 450.5 into integer minor units (45050). */
export function toMinor(major: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(major * factor);
}

/** Converts integer minor units back to a float for display-only math. */
export function toMajor(minor: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return minor / factor;
}

/** Integer addition. Never use `+` on amounts directly. */
export function addMoney(...amounts: number[]): number {
  return amounts.reduce((acc, n) => acc + Math.round(n), 0);
}

/** Integer subtraction. */
export function subtractMoney(a: number, b: number): number {
  return Math.round(a) - Math.round(b);
}

/** Sums a list of integer amounts. */
export function sumMoney(amounts: number[]): number {
  return amounts.reduce((acc, n) => acc + Math.round(n), 0);
}

/**
 * part / total as a percentage (0–100). Returns 0 when total is 0 instead of
 * NaN/Infinity so callers can render safely.
 */
export function calculatePercentage(part: number, total: number): number {
  if (!total) return 0;
  return (part / total) * 100;
}

/**
 * Percent change from `previous` to `current`. Returns null when there is no
 * meaningful baseline (previous === 0) so the UI can render "—" / "New".
 */
export function percentageChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function groupIntegerString(digits: string, style: GroupingStyle): string {
  if (digits.length <= 3) return digits;
  if (style === 'indian') {
    const head = digits.slice(0, -3);
    const tail = digits.slice(-3);
    return `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${tail}`;
  }
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export interface FormatMoneyOptions {
  currency?: string;
  grouping?: GroupingStyle;
  /** Override fraction digits, or 'auto' to hide trailing zeros. */
  decimals?: number | 'auto';
  /** Show the currency symbol. Default true. */
  showSymbol?: boolean;
  /** 'auto' (default) prints "-" for negatives; 'always' forces "+" for positives; 'never' hides the sign. */
  sign?: 'auto' | 'always' | 'never';
  /** Use compact notation (₹1.2L / ₹12.4K). Good for charts and tight tiles. */
  compact?: boolean;
  /** Force the absolute value (useful for outflows displayed without a sign). */
  absolute?: boolean;
}

/**
 * Formats integer minor units for display.
 *   formatMoney(45050)                    → "₹450.50"
 *   formatMoney(-123456789)               → "-₹12,34,567.89"
 *   formatMoney(12000000, {compact:true}) → "₹1.2L"
 */
export function formatMoney(minor: number, options: FormatMoneyOptions = {}): string {
  const info = currencyInfo(options.currency ?? 'INR');
  const value = Math.round(minor);
  const negative = value < 0;
  const abs = Math.abs(value);
  const grouping = options.grouping ?? info.grouping;
  /** Storage exponent for the currency (2 for INR/USD, 0 for JPY). */
  const exponent = info.decimals;
  const factor = 10 ** exponent;
  const whole = Math.floor(abs / factor);
  const fraction = abs % factor;

  // `decimals` controls DISPLAY precision only; the stored value is always
  // interpreted with the currency's own exponent.
  const requested = options.decimals;
  const displayDecimals =
    requested === 'auto'
      ? fraction === 0
        ? 0
        : exponent
      : typeof requested === 'number'
        ? Math.max(0, Math.min(exponent, Math.round(requested)))
        : exponent;

  let numberText: string;
  if (options.compact) {
    // Rupee amounts always use Indian compact terms (₹1.2L, ₹3.4Cr) — "M/B"
    // reads as a foreign convention even if the digit grouping is western.
    numberText = compactNumber(abs, exponent, grouping, info.code === 'INR');
  } else {
    let displayWhole = whole;
    let displayFraction = 0;
    if (displayDecimals > 0) {
      const scale = 10 ** (exponent - displayDecimals);
      displayFraction = scale > 1 ? Math.round(fraction / scale) : fraction;
      if (displayFraction >= 10 ** displayDecimals) {
        displayWhole += 1;
        displayFraction = 0;
      }
    } else if (exponent > 0) {
      // Hiding paise rounds to the nearest whole unit rather than truncating.
      displayWhole = fraction * 2 >= factor ? whole + 1 : whole;
    }
    const wholeText = groupIntegerString(String(displayWhole), grouping);
    numberText =
      displayDecimals > 0
        ? `${wholeText}.${String(displayFraction).padStart(displayDecimals, '0')}`
        : wholeText;
  }

  const symbol = options.showSymbol === false ? '' : info.symbol;
  const signOption = options.sign ?? 'auto';
  // Sign rules: `absolute` and `never` suppress the sign, `always` forces a
  // plus for positive values, `auto` shows a minus only for negatives.
  const signPrefix =
    options.absolute || signOption === 'never'
      ? ''
      : negative
        ? '-'
        : signOption === 'always'
          ? '+'
          : '';

  return `${signPrefix}${symbol}${numberText}`;
}

function trimZeroDecimal(text: string): string {
  if (!text.includes('.')) return text;
  // Numeric round-trip removes trailing zeros deterministically ("1.00" → "1").
  return String(Number(text));
}

function compactNumber(absMinor: number, exponent: number, grouping: GroupingStyle, indianSuffixes = false): string {
  const factor = 10 ** exponent;
  const major = absMinor / factor;
  if (grouping === 'indian' || indianSuffixes) {
    if (major >= 1e7) return `${trimZeroDecimal((major / 1e7).toFixed(2))}Cr`;
    if (major >= 1e5) return `${trimZeroDecimal((major / 1e5).toFixed(2))}L`;
    if (major >= 1e3) return `${trimZeroDecimal((major / 1e3).toFixed(1))}K`;
  } else {
    if (major >= 1e9) return `${trimZeroDecimal((major / 1e9).toFixed(2))}B`;
    if (major >= 1e6) return `${trimZeroDecimal((major / 1e6).toFixed(2))}M`;
    if (major >= 1e3) return `${trimZeroDecimal((major / 1e3).toFixed(1))}K`;
  }
  // Below 1K: fall back to the plain representation.
  const whole = Math.floor(absMinor / factor);
  const fraction = absMinor % factor;
  return exponent > 0 && fraction > 0
    ? `${groupIntegerString(String(whole), grouping)}.${String(fraction).padStart(exponent, '0')}`
    : groupIntegerString(String(whole), grouping);
}

/**
 * Parses user input ("1,23,456.50", "₹450", "-12.5") into integer minor units.
 * Extra decimal digits round half-up on the digit string (never on floats), so
 * "12.345" becomes 1235 paise. Returns null when the input is not a valid amount.
 */
export function parseMoney(input: string | number, decimals = 2): number | null {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return toMinor(input, decimals);
  }
  let text = input.trim();
  if (!text) return null;

  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.startsWith('-') || text.startsWith('−')) {
    negative = true;
    text = text.slice(1);
  }
  // Strip currency symbols, spaces, and grouping separators.
  text = text.replace(/[^\d.,]/g, '').replace(/,/g, '');
  if (!text) return null;

  const parts = text.split('.');
  if (parts.length > 2) return null;
  const wholeText = parts[0] === '' ? '0' : parts[0]!;
  if (!/^\d+$/.test(wholeText)) return null;
  const fractionText = parts[1] ?? '';
  if (fractionText !== '' && !/^\d+$/.test(fractionText)) return null;

  let whole = Number(wholeText);
  let fraction: number;

  if (decimals <= 0) {
    fraction = 0;
    if (Number(fractionText[0] ?? '0') >= 5) whole += 1;
  } else {
    const kept = fractionText.slice(0, decimals).padEnd(decimals, '0');
    fraction = Number(kept);
    const nextDigit = Number(fractionText[decimals] ?? '0');
    if (nextDigit >= 5) {
      fraction += 1;
      if (fraction >= 10 ** decimals) {
        whole += 1;
        fraction = 0;
      }
    }
  }

  const minor = whole * 10 ** decimals + fraction;
  if (!Number.isFinite(minor)) return null;
  return negative ? -minor : minor;
}

/** Formats a raw percentage value: formatPercent(47.36) → "47.4%" */
export function formatPercent(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = Number(value.toFixed(digits));
  return `${rounded}%`;
}
