import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/theme/theme';
import { AppText } from './ui/text';
import { Card } from './ui/layout';
import { useSettingsStore } from '@/stores/settings.store';
import { buildFinanceContext } from '@/ai/context';
import { describeAiError } from '@/ai/types';
import { generateMonthlyReview, type MonthlyReviewSummary } from '@/ai/features';
import { formatMonthYear, type DateRange } from '@/utils/date';

/**
 * AI summary block for the monthly report. The engine has already calculated
 * every metric on this screen; the model only writes the interpretation, and
 * only when the user has AI + monthly review turned on with a key configured.
 */

type State =
  | { status: 'loading' }
  | { status: 'off' }
  | { status: 'error'; message: string }
  | { status: 'ready'; summary: MonthlyReviewSummary };

export function AiMonthlyReview({ range }: { range: DateRange }) {
  const theme = useTheme();
  const ai = useSettingsStore((state) => state.ai);
  const monthStartDay = useSettingsStore((state) => state.general.monthStartDay);
  const currency = useSettingsStore((state) => state.general.currency);
  const [state, setState] = useState<State>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);

  const ready = ai.enabled && ai.monthlyReview && ai.apiKey.trim().length > 0 && ai.privacy !== 'none';
  const periodKey = formatMonthYear(range.start);

  const load = useCallback(async () => {
    if (!ready) {
      setState({ status: 'off' });
      return;
    }
    setState({ status: 'loading' });
    try {
      const context = await buildFinanceContext({
        monthStartDay,
        currency,
        range,
        periodLabel: periodKey,
      });
      if (context.income <= 0 && context.expenses <= 0) {
        setState({ status: 'off' });
        return;
      }
      const result = await generateMonthlyReview(context);
      setState(result.ok ? { status: 'ready', summary: result.data } : { status: 'error', message: describeAiError(result.error) });
    } catch (error) {
      setState({ status: 'error', message: error instanceof Error ? error.message : 'Could not build the AI context.' });
    }
  }, [ready, monthStartDay, currency, range, periodKey]);

  useEffect(() => {
    void load();
  }, [load, nonce]);

  if (state.status === 'off') return null;

  if (state.status === 'loading') {
    return (
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          <Ionicons name="sparkles-outline" size={15} color={theme.colors.accent.base} />
          <AppText variant="label" tone="muted">
            AI REVIEW
          </AppText>
        </View>
        <AppText variant="bodySmall" tone="muted" style={{ marginTop: theme.spacing.md }}>
          Reading the month…
        </AppText>
      </Card>
    );
  }

  if (state.status === 'error') {
    return (
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
            <Ionicons name="sparkles-outline" size={15} color={theme.colors.muted} />
            <AppText variant="label" tone="muted">
              AI REVIEW
            </AppText>
          </View>
          <Pressable onPress={() => setNonce((value) => value + 1)} hitSlop={10}>
            <AppText variant="captionMedium" tone="accent">
              Retry
            </AppText>
          </Pressable>
        </View>
        <AppText variant="caption" tone="muted" style={{ marginTop: theme.spacing.md }}>
          {state.message}
        </AppText>
      </Card>
    );
  }

  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <Ionicons name="sparkles-outline" size={15} color={theme.colors.accent.base} />
        <AppText variant="label" tone="muted">
          AI REVIEW · {periodKey.toUpperCase()}
        </AppText>
      </View>
      <AppText variant="bodyMedium" style={{ marginTop: theme.spacing.md }}>
        {state.summary.headline}
      </AppText>

      {state.summary.changed.length > 0 ? (
        <View style={{ marginTop: theme.spacing.md, gap: theme.spacing.xs }}>
          <AppText variant="captionMedium" tone="secondary">
            What changed
          </AppText>
          {state.summary.changed.map((entry) => (
            <View key={`${entry.label}-${entry.detail}`} style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              <View style={[styles.dot, { backgroundColor: theme.colors.accent.base }]} />
              <AppText variant="caption" tone="secondary" style={{ flex: 1 }}>
                {entry.label}
                {entry.detail ? ` — ${entry.detail}` : ''}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}

      {state.summary.goingWell.length > 0 ? (
        <View style={{ marginTop: theme.spacing.md, gap: theme.spacing.xs }}>
          <AppText variant="captionMedium" tone="secondary">
            Going well
          </AppText>
          {state.summary.goingWell.map((entry) => (
            <View key={entry} style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              <View style={[styles.dot, { backgroundColor: theme.colors.positive }]} />
              <AppText variant="caption" tone="secondary" style={{ flex: 1 }}>
                {entry}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}

      {state.summary.watch.length > 0 ? (
        <View style={{ marginTop: theme.spacing.md, gap: theme.spacing.xs }}>
          <AppText variant="captionMedium" tone="secondary">
            Watch next month
          </AppText>
          {state.summary.watch.map((entry) => (
            <View key={entry} style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              <View style={[styles.dot, { backgroundColor: theme.colors.warning }]} />
              <AppText variant="caption" tone="secondary" style={{ flex: 1 }}>
                {entry}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    marginTop: 6,
  },
});
