import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { Card, Row, ScrollScreen, ScreenHeader } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { LoadingBlock } from '@/components/ui/feedback';
import { AppCalendar, LedgerDayCell, CalendarArrow, type DateData } from '@/components/ui/calendar';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { listTransactions } from '@/services/transactions.service';
import { getRecurringCalendar } from '@/services/recurring.service';
import { endOfMonth, formatMonthYear, fromISODate, startOfMonth, toISODate } from '@/utils/date';

/**
 * Calendar — income, spending and scheduled payments laid out by day, with a
 * per-day breakdown on tap. The month grid is `react-native-calendars`
 * (swipe, accessibility, month paging) with Wallnut's day cells on top.
 */
export default function CalendarScreen() {
  const theme = useTheme();
  const money = useMoney();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState<Date | null>(new Date());

  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  const monthStartKey = toISODate(monthStart);
  const monthEndKey = toISODate(monthEnd);

  const query = useQuery(async () => {
    const [transactions, schedule] = await Promise.all([
      listTransactions({
        from: monthStartKey,
        to: monthEndKey,
        limit: 800,
        includeTransfers: true,
        includeRefunds: true,
        includeAdjustments: true,
        includeDebtActivity: true,
        sort: 'date_asc',
      }),
      getRecurringCalendar(monthStart, monthEnd),
    ]);
    return { transactions, schedule };
  }, [monthStartKey, monthEndKey]);

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
    let busiest = 0;
    for (const entry of byDay.values()) {
      income += entry.income;
      expense += entry.expense;
      busiest = Math.max(busiest, entry.expense);
    }
    return { income, expense, busiest };
  }, [byDay]);

  const selectedKey = selected ? toISODate(selected) : null;
  const selectedTransactions = (query.data?.transactions ?? []).filter((row) => row.date === selectedKey);

  const markedDates = useMemo(
    () => (selectedKey ? { [selectedKey]: { selected: true } } : {}),
    [selectedKey],
  );

  const renderDayFooter = (date: DateData) => {
    const entry = byDay.get(date.dateString);
    if (entry) {
      return (
        <View style={{ gap: 0.5 }}>
          {entry.income > 0 ? (
            <AppText variant="caption" tone="positive" style={{ fontSize: 8.5, lineHeight: 10 }} numberOfLines={1}>
              +{money.format(entry.income, { compact: true })}
            </AppText>
          ) : null}
          {entry.expense > 0 ? (
            <AppText variant="caption" tone="negative" style={{ fontSize: 8.5, lineHeight: 10 }} numberOfLines={1}>
              −{money.format(entry.expense, { compact: true })}
            </AppText>
          ) : null}
        </View>
      );
    }
    if ((scheduledByDay.get(date.dateString) ?? 0) !== 0) {
      return <Ionicons name="repeat" size={9} color={theme.colors.muted} />;
    }
    return null;
  };

  return (
    <ScrollScreen>
      <ScreenHeader
        title="Calendar"
        subtitle={formatMonthYear(month)}
        hint={{ id: 'calendar', message: 'A day-by-day view of income, spending and bills. Swipe or step through months to plan around paydays and due dates.' }}
      />

      <View style={{ gap: theme.spacing.lg }}>
        <Card padded={false} style={{ paddingVertical: theme.spacing.sm }}>
          <AppCalendar
            initialDate={toISODate(monthStart)}
            markedDates={markedDates}
            dayComponent={(props) => {
              const key = props.date?.dateString ?? '';
              const entry = key ? byDay.get(key) : undefined;
              return (
                <LedgerDayCell
                  {...props}
                  renderFooter={renderDayFooter}
                  highlighted={Boolean(entry)}
                  intensity={entry && monthTotals.busiest > 0 ? Math.min(1, entry.expense / monthTotals.busiest) : 0}
                />
              );
            }}
            renderArrow={(direction) => <CalendarArrow direction={direction === 'left' ? 'left' : 'right'} />}
            onDayPress={(day) => {
              const parsed = fromISODate(day.dateString);
              if (parsed) setSelected(parsed);
            }}
            onMonthChange={(day) => {
              const parsed = fromISODate(day.dateString);
              if (parsed) setMonth(startOfMonth(parsed));
            }}
          />

          <Row
            justify="space-between"
            style={{
              marginTop: theme.spacing.sm,
              paddingTop: theme.spacing.md,
              paddingHorizontal: theme.spacing.lg,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: theme.colors.border,
            }}>
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
                  style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingVertical: 12 }}>
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
