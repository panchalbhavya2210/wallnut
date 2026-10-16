import { useMemo } from 'react';

import { useSettingsStore } from '@/stores/settings.store';
import { formatMoney, formatPercent, parseMoney, type FormatMoneyOptions } from '@/utils/money';

export interface MoneyFormat {
  /** Formats integer minor units using the user's currency + grouping. */
  format: (minor: number, options?: Partial<FormatMoneyOptions>) => string;
  /** Parses user input into integer minor units. */
  parse: (input: string) => number | null;
  currency: string;
  grouping: 'indian' | 'western';
  percent: (value: number, digits?: number) => string;
}

export function useMoney(): MoneyFormat {
  const currency = useSettingsStore((state) => state.general.currency);
  const grouping = useSettingsStore((state) => state.general.numberGrouping);
  const showDecimals = useSettingsStore((state) => state.general.showDecimals);
  const hideAmounts = useSettingsStore((state) => state.security.hideAmounts);

  return useMemo(
    () => ({
      currency,
      grouping,
      format: (minor, options = {}) => {
        const text = formatMoney(minor, {
          currency,
          grouping,
          decimals: options.decimals ?? (showDecimals ? 2 : 'auto'),
          ...options,
        });
        // Privacy mode: mask digits at the single formatting chokepoint so no
        // screen can leak an amount by formatting it directly.
        return hideAmounts ? text.replace(/\d/g, '•') : text;
      },
      parse: (input) => parseMoney(input),
      percent: formatPercent,
    }),
    [currency, grouping, showDecimals, hideAmounts],
  );
}
