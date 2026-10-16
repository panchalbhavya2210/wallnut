import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { AppText } from './ui/text';
import { Card } from './ui/layout';
import { useSettingsStore } from '@/stores/settings.store';
import { buildFinanceContext } from '@/ai/context';
import { describeAiError } from '@/ai/types';
import { generateInsight, type AiFocus, type AiInsight } from '@/ai/features';

/**
 * AI insight card for Home.
 *
 * Loads independently of the dashboard (the page never waits on the network),
 * runs at most once per app session unless refreshed, and degrades to a quiet
 * retry card when DeepSeek is unreachable. The financial engine provides every
 * number; the model only phrases the observation.
 */

const FOCUS_LINKS: Record<Exclude<AiFocus, null>, { label: string; href: string }> = {
  spending: { label: 'View spending', href: '/analytics' },
  budgets: { label: 'Review budgets', href: '/budgets' },
  subscriptions: { label: 'Review subscriptions', href: '/recurring' },
  savings: { label: 'Monthly review', href: '/reports/monthly' },
  debt: { label: 'Money owed', href: '/debts' },
  recurring: { label: 'Recurring', href: '/recurring' },
};

type InsightState =
  | { status: 'loading' }
  | { status: 'off' }
  | { status: 'ready'; insight: AiInsight; cached: boolean }
  | { status: 'error'; message: string };

// Session-level memo so switching tabs does not re-run the model.
let sessionMemo: { key: string; state: InsightState } | null = null;

export function AiInsightCard() {
  const theme = useTheme();
  const ai = useSettingsStore((state) => state.ai);
  const monthStartDay = useSettingsStore((state) => state.general.monthStartDay);
  const currency = useSettingsStore((state) => state.general.currency);
  const [state, setState] = useState<InsightState>(() => sessionMemo?.state ?? { status: 'loading' });
  const mounted = useRef(true);

  const ready = ai.enabled && ai.insights && ai.apiKey.trim().length > 0 && ai.privacy !== 'none';

  const load = useCallback(
    async (force: boolean) => {
      const key = `${new Date().toISOString().slice(0, 7)}:${ai.model}:${monthStartDay}:${currency}`;
      if (!force && sessionMemo && sessionMemo.key === key) {
        setState(sessionMemo.state);
        return;
      }
      if (!ready) {
        setState({ status: 'off' });
        sessionMemo = { key, state: { status: 'off' } };
        return;
      }
      setState({ status: 'loading' });
      try {
        const context = await buildFinanceContext({ monthStartDay, currency });
        if (context.income <= 0 && context.expenses <= 0) {
          const empty: InsightState = { status: 'off' };
          sessionMemo = { key, state: empty };
          setState(empty);
          return;
        }
        const result = await generateInsight(context);
        const next: InsightState = result.ok
          ? { status: 'ready', insight: result.data, cached: result.cached }
          : { status: 'error', message: describeAiError(result.error) };
        sessionMemo = { key, state: next };
        if (mounted.current) setState(next);
      } catch (error) {
        const next: InsightState = { status: 'error', message: error instanceof Error ? error.message : 'Could not build the AI context.' };
        sessionMemo = { key, state: next };
        if (mounted.current) setState(next);
      }
    },
    [ready, ai.model, monthStartDay, currency],
  );

  useEffect(() => {
    mounted.current = true;
    void load(false);
    return () => {
      mounted.current = false;
    };
  }, [load]);

  if (state.status === 'off') return null;

  if (state.status === 'loading') {
    return (
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          <View style={[styles.badge, { backgroundColor: theme.colors.accent.soft }]}>
            <Ionicons name="sparkles-outline" size={13} color={theme.colors.accent.base} />
          </View>
          <AppText variant="label" tone="muted">
            AI INSIGHT
          </AppText>
        </View>
        <AppText variant="bodySmall" tone="muted" style={{ marginTop: theme.spacing.md }}>
          Reading your month…
        </AppText>
      </Card>
    );
  }

  if (state.status === 'error') {
    return (
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
            <View style={[styles.badge, { backgroundColor: theme.colors.neutralSoft }]}>
              <Ionicons name="sparkles-outline" size={13} color={theme.colors.muted} />
            </View>
            <AppText variant="label" tone="muted">
              AI INSIGHT
            </AppText>
          </View>
          <Pressable onPress={() => void load(true)} hitSlop={10}>
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

  const { insight } = state;
  const tint =
    insight.severity === 'positive'
      ? theme.colors.positive
      : insight.severity === 'warning'
        ? theme.colors.warning
        : theme.colors.accent.base;
  const link = insight.focus ? FOCUS_LINKS[insight.focus] : null;

  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          <View style={[styles.badge, { backgroundColor: `${tint}22` }]}>
            <Ionicons name="sparkles-outline" size={13} color={tint} />
          </View>
          <AppText variant="label" tone="muted">
            AI INSIGHT
          </AppText>
        </View>
        <AppText variant="caption" tone="muted">
          {state.cached ? 'cached' : 'just now'}
        </AppText>
      </View>
      <AppText variant="bodyMedium" style={{ marginTop: theme.spacing.md }}>
        {insight.title}
      </AppText>
      <AppText variant="bodySmall" tone="secondary" style={{ marginTop: theme.spacing.xs }}>
        {insight.summary}
      </AppText>
      {link ? (
        <Pressable
          onPress={() => router.push(link.href as never)}
          style={({ pressed }) => ({
            marginTop: theme.spacing.md,
            alignSelf: 'flex-start',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            opacity: pressed ? 0.7 : 1,
          })}>
          <AppText variant="captionMedium" tone="accent">
            {link.label}
          </AppText>
          <Ionicons name="arrow-forward" size={13} color={theme.colors.accent.base} />
        </Pressable>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  badge: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
