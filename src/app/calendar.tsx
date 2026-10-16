import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { Card, Row, ScrollScreen, ScreenHeader } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { IconButton } from '@/components/ui/controls';
import { EmptyState, LoadingBlock } from '@/components/ui/feedback';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { listTransactions } from '@/services/transactions.service';
import { getRecurringCalendar } from '@/services/recurring.service';
import { addDays, addMonths, endOfMonth, formatMonthYear, isSameDay, startOfMonth, startOfWeek, toISODate } from '@/utils/date';
import { formatPercent } from '@/utils/money';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/**
 * Calendar — income, spending and scheduled payments laid out by day, with a
 * per-day breakdown on tap.
 */
export default function CalendarScreen() {
  const theme = useTheme();
  const money = useMoney();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState<Date | null>(new Date());

  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const cells = useMemo(() => Array.from({ length: 42 }, (_, index) => addDays(gridStart, index)), [gridStart]);

  const query = useQuery(async () => {
    const [transactions, schedule] = await Promise.all([
      listTransactions({
        from: toISODate(gridStart),
        to: toISODate(addDays(gridStart, 41)),
        limit: 500,
        includeTransfers: true,
        includeRefunds: true,
        includeAdjustments: true,
        includeDebtActivity: true,
        sort: 'date_asc',
      }),
      getRecurringCalendar(monthStart, monthEnd),
    ]);
    return { transactions, schedule };
  }, [toISODate(gridStart), toISODate(monthEnd)]);

  const byDay = useMemo(() => {
    const map = new Map<string, { income: number; expense: number; count: number }>();
    for (const row of query.data?.transactions ?? []) {
      const entry = map.get(row.date) ?? { income: 0, expense: 0, count: 0 };
      if (row.type === 'income') entry.income += row.amount;
      if (row.type === 'expense') entry.expense += Math.abs(row.amount);
      if (row.type === 'refund') entry.expense -= Math.abs(row.amount);
      entry.count += 1;
      map.set(row.date, entry);
    }
    return map;
  }, [query.data]);

  const scheduledByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of query.data?.schedule ?? []) {
      map.set(entry.date, (map.get(entry.date) ?? 0) + entry.amount);
    }
    return map;
  }, [query.data]);

  const monthTotals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const cell of cells) {
      if (cell.getMonth() !== month.getMonth()) continue;
      const entry = byDay.get(toISODate(cell));
      if (!entry) continue;
      income += entry.income;
      expense += entry.expense;
    }
    return { income, expense };
  }, [cells, byDay, month]);

  const selectedKey = selected ? toISODate(selected) : null;
  const selectedTransactions = (query.data?.transactions ?? []).filter((row) => row.date === selectedKey);

  return (
    <ScrollScreen>
      <ScreenHeader
        title="Calendar"
        subtitle={formatMonthYear(month)}
        hint={{ id: 'calendar', message: 'A day-by-day view of income, spending and bills. Step through months to plan around paydays and due dates.' }}
      />

      <View style={{ gap: theme.spacing.lg }}>
        <Card>
          <Row justify="space-between" style={{ marginBottom: theme.spacing.md }}>
            <IconButton icon="chevron-back" onPress={() => setMonth(addMonths(month, -1))} accessibilityLabel="Previous month" />
            <AppText variant="titleSmall">{formatMonthYear(month)}</AppText>
            <IconButton icon="chevron-forward" onPress={() => setMonth(addMonths(month, 1))} accessibilityLabel="Next month" />
          </Row>

          <View style={{ flexDirection: 'row' }}>
            {WEEKDAYS.map((day, index) => (
              <View key={`${day}-${index}`} style={{ flex: 1, alignItems: 'center', paddingVertical: 4 }}>
                <AppText variant="caption" tone="muted">
                  {day}
                </AppText>
              </View>
            ))}
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {cells.map((cell) => {
              const key = toISODate(cell);
              const inMonth = cell.getMonth() === month.getMonth();
              const entry = byDay.get(key);
              const scheduled = scheduledByDay.get(key) ?? 0;
              const isSelected = selectedKey === key;
              const isToday = isSameDay(cell, new Date());
              const intensity = entry ? Math.min(1, entry.expense / Math.max(1, monthTotals.expense / 8)) : 0;
              return (
                <Pressable
                  key={key}
                  onPress={() => setSelected(cell)}
                  style={{ width: `${100 / 7}%`, height: 56, padding: 2 }}>
                  <View
                    style={{
                      flex: 1,
                      borderRadius: theme.radius.sm,
                      padding: 4,
                      backgroundColor: isSelected
                        ? theme.colors.accent.soft
                        : entry && inMonth
                          ? `${theme.colors.accent.base}${Math.round(intensity * 22 + 8).toString(16).padStart(2, '0')}`
                          : 'transparent',
                      borderWidth: isToday ? 1 : isSelected ? 1 : 0,
                      borderColor: isToday ? theme.colors.accent.base : theme.colors.accent.base,
                      opacity: inMonth ? 1 : 0.35,
                    }}>
                    <AppText variant="captionMedium" tone={isToday ? 'accent' : 'secondary'}>
                      {cell.getDate()}
                    </AppText>
                    {entry ? (
                      <View style={{ marginTop: 2, gap: 1 }}>
                        {entry.income > 0 ? (
                          <AppText variant="caption" tone="positive" style={{ fontSize: 9, lineHeight: 11 }} numberOfLines={1}>
                            +{money.format(entry.income, { compact: true })}
                          </AppText>
                        ) : null}
                        {entry.expense > 0 ? (
                          <AppText variant="caption" tone="negative" style={{ fontSize: 9, lineHeight: 11 }} numberOfLines={1}>
                            −{money.format(entry.expense, { compact: true })}
                          </AppText>
                        ) : null}
                      </View>
                    ) : scheduled !== 0 ? (
                      <View style={{ marginTop: 2 }}>
                        <Ionicons name="repeat" size={9} color={theme.colors.muted} />
                      </View>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>

          <Row justify="space-between" style={{ marginTop: theme.spacing.md, paddingTop: theme.spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border }}>
            <View>
              <AppText variant="caption" tone="muted">
                Month income
              </AppText>
              <MoneyText amount={monthTotals.income} variant="numericSmall" tone="positive" />
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <AppText variant="caption" tone="muted">
                Month spending
              </AppText>
              <MoneyText amount={-monthTotals.expense} variant="numericSmall" tone="negative" />
            </View>
          </Row>
        </Card>

        <Card>
          <AppText variant="label" tone="muted">
            {selected ? selected.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) : 'Pick a day'}
          </AppText>
          {selectedTransactions.length === 0 ? (
            <AppText variant="caption" tone="muted" style={{ marginTop: theme.spacing.sm }}>
              No transactions recorded on this day.
              {selectedKey && scheduledByDay.get(selectedKey) ? ` ${money.format(scheduledByDay.get(selectedKey)!)} scheduled.` : ''}
            </AppText>
          ) : (
            <View style={{ marginTop: theme.spacing.sm }}>
              {selectedTransactions.map((row) => (
                <Pressable
                  key={row.id}
                  onPress={() => router.push(`/transaction/${row.id}` as never)}
                  android_ripple={{ color: theme.colors.ripple }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingVertical: 10 }}>
                  <View style={{ flex: 1 }}>
                    <AppText variant="bodySmall" numberOfLines={1}>
                      {row.merchant || row.description || row.categoryName || 'Transaction'}
                    </AppText>
                    <AppText variant="caption" tone="muted" numberOfLines={1}>
                      {row.categoryName ?? 'Uncategorised'} · {row.accountName}
                    </AppText>
                  </View>
                  <MoneyText amount={row.amount} variant="numericCaption" tone={row.isTransfer ? 'neutral' : 'auto'} />
                </Pressable>
              ))}
            </View>
          )}
        </Card>

        {query.loading ? <LoadingBlock /> : null}
      </View>
    </ScrollScreen>
  );
}
