import React, { useCallback, useMemo } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, type ErrorBoundaryProps } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { HeaderScrollScreen, ScrollScreen, Row } from '@/components/ui/layout';
import { GradientBlobs } from '@/components/ui/backdrop';
import { AppText } from '@/components/ui/text';
import { AppHeader } from '@/components/AppHeader';
import { AccountScopeRow } from '@/components/AccountScope';
import { AiInsightCard } from '@/components/AiInsightCard';
import { WidgetBoundary } from '@/components/WidgetBoundary';
import { EmptyState, ErrorBlock, LoadingBlock } from '@/components/ui/feedback';
import { renderWidget } from '@/components/widgets';
import { useQuery, useNow } from '@/hooks/useQuery';
import { useUiStore } from '@/stores/ui.store';
import { useSettingsStore } from '@/stores/settings.store';
import { getDb } from '@/db/client';
import { dashboardWidgets, transactions as transactionsTable, accounts as accountsTable } from '@/db/schema';
import { asc, eq, sql } from 'drizzle-orm';
import type { DashboardWidget } from '@/db/schema';
import { getReviewQueue } from '@/services/review.service';

/**
 * Home — the financial command centre.
 *
 * Three levels, in order: financial status (balance hero + quick actions),
 * spending overview (cash flow, categories) and recent activity. The sections
 * are the configurable dashboard widgets, so the default layout behaves like a
 * production finance app while power users can still rearrange everything.
 *
 * Performance: the greeting owns the minute clock (not the screen), and the
 * widget tree is memoized against the widget rows + account scope, so neither
 * ticking time nor unrelated store changes can re-render every card.
 */
export default function HomeScreen() {
  const theme = useTheme();
  const userName = useSettingsStore((state) => state.general.userName);
  const density = useSettingsStore((state) => state.dashboard.density);
  const scopeAccountId = useUiStore((state) => state.accountScopeId);

  const widgets = useQuery(async () => {
    const db = getDb();
    const rows = await db
      .select()
      .from(dashboardWidgets)
      .where(eq(dashboardWidgets.isVisible, true))
      .orderBy(asc(dashboardWidgets.position));
    const [accountsCount] = await db.select({ count: sql<number>`count(*)` }).from(accountsTable);
    const [transactionsCount] = await db.select({ count: sql<number>`count(*)` }).from(transactionsTable);
    const reviewCount = (await getReviewQueue(50)).length;
    return {
      widgets: rows.filter((row) => row.type !== 'review_queue' || reviewCount > 0),
      isEmpty: Number(transactionsCount?.count ?? 0) === 0 && Number(accountsCount?.count ?? 0) === 0,
      reviewCount,
    };
  }, []);

  // Refresh relative dates and schedules when the screen regains focus.
  const refresh = widgets.refresh;
  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(() => refresh(), 250);
      return () => clearTimeout(timer);
    }, [refresh]),
  );

  const navigate = useCallback((href: string) => {
    router.push(href as never);
  }, []);

  const rows = useMemo(() => packWidgets(widgets.data?.widgets ?? []), [widgets.data?.widgets]);

  // The element tree only changes when the actual widget rows or the account
  // scope change — store updates elsewhere in the app leave it untouched.
  const widgetTree = useMemo(
    () => (
      <>
        {rows.map((row, index) => (
          <View key={`row-${index}`} style={{ flexDirection: 'row', gap: theme.spacing.md, alignItems: 'flex-start' }}>
            {row.map((widget) => (
              <View key={widget.id} style={{ flex: 1, minWidth: 0 }}>
                <WidgetBoundary key={widget.id}>{renderWidget(widget, navigate, scopeAccountId)}</WidgetBoundary>
              </View>
            ))}
          </View>
        ))}
      </>
    ),
    [rows, navigate, scopeAccountId, theme.spacing.md],
  );

  if (widgets.error) {
    return (
      <ScrollScreen>
        <AppHeader brand />
        <ErrorBlock message={widgets.error.message} onRetry={widgets.refresh} />
      </ScrollScreen>
    );
  }

  return (
    <HeaderScrollScreen
      header={
        <AppHeader
          brand
          reviewCount={widgets.data?.reviewCount ?? 0}
          onSearch={() => router.push('/transactions?search=1' as never)}
        />
      }
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={() => refresh()}
          tintColor={theme.colors.muted}
        />
      }>
      <GradientBlobs />
      <GreetingLine userName={userName} />

      {widgets.loading && !widgets.data ? (
        <LoadingBlock label="Opening your ledger…" />
      ) : widgets.data?.isEmpty ? (
        <View style={{ marginTop: theme.spacing.xl }}>
          <EmptyState
            icon="wallet-outline"
            title="Welcome to Wallnut"
            message="Add an account and your first transaction — everything else (net worth, cash flow, budgets, insights) builds itself from there."
            actionLabel="Add a transaction"
            onAction={() => navigate('/transaction/new')}
          />
          <View style={{ alignItems: 'center', gap: theme.spacing.md }}>
            <AppText variant="caption" tone="muted">
              or set up accounts first
            </AppText>
            <Row gap="sm">
              <AppText variant="captionMedium" tone="accent" onPress={() => navigate('/accounts')}>
                Manage accounts
              </AppText>
              <AppText variant="caption" tone="muted">
                ·
              </AppText>
              <AppText variant="captionMedium" tone="accent" onPress={() => navigate('/settings/data')}>
                Import or restore
              </AppText>
            </Row>
          </View>
        </View>
      ) : (
        <View style={{ gap: density === 'compact' ? theme.spacing.lg : theme.spacing.xl, marginTop: theme.spacing.lg }}>
          <WidgetBoundary>
            <AccountScopeRow />
          </WidgetBoundary>

          {widgetTree}

          <WidgetBoundary>
            <AiInsightCard />
          </WidgetBoundary>

          <Pressable
            onPress={() => navigate('/settings/dashboard')}
            accessibilityRole="button"
            accessibilityLabel="Customise dashboard"
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: theme.spacing.sm,
              paddingVertical: theme.spacing.md,
              borderRadius: theme.radius.full,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.colors.border,
              backgroundColor: pressed ? theme.colors.pressed : 'transparent',
            })}>
            <Ionicons name="options-outline" size={16} color={theme.colors.textSecondary} />
            <AppText variant="bodySmall" tone="secondary">
              Customise dashboard
            </AppText>
          </Pressable>
        </View>
      )}
    </HeaderScrollScreen>
  );
}

/**
 * The greeting owns the minute clock so the dashboard itself never re-renders
 * on a tick — only this one line does.
 */
function GreetingLine({ userName }: { userName: string | null }) {
  const theme = useTheme();
  const now = useNow();
  return (
    <AppText variant="bodySmall" tone="muted" style={{ marginTop: theme.spacing.sm }}>
      {getGreeting(now)}
      {userName ? `, ${userName}` : ''} · {now.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}
    </AppText>
  );
}

/** Full-width widgets occupy their own row; halves pair up. */
function packWidgets(widgets: DashboardWidget[]): DashboardWidget[][] {
  const rows: DashboardWidget[][] = [];
  let pending: DashboardWidget | null = null;
  for (const widget of widgets) {
    if (widget.width === 'full') {
      if (pending) {
        rows.push([pending]);
        pending = null;
      }
      rows.push([widget]);
    } else if (pending) {
      rows.push([pending, widget]);
      pending = null;
    } else {
      pending = widget;
    }
  }
  if (pending) rows.push([pending]);
  return rows;
}

function getGreeting(date: Date): string {
  const hour = date.getHours();
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 21) return 'Good evening';
  return 'Good night';
}

/**
 * Route-level crash handler: a render error on the dashboard shows a friendly
 * recovery screen instead of killing the app (the per-widget boundaries catch
 * card-level errors before they reach this).
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.colors.background,
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.spacing.lg,
        padding: theme.spacing.xxl,
      }}>
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: theme.radius.xl,
          backgroundColor: theme.colors.warningSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <Ionicons name="warning-outline" size={26} color={theme.colors.warning} />
      </View>
      <AppText variant="title" style={{ textAlign: 'center' }}>
        The dashboard hit a problem
      </AppText>
      <AppText variant="bodySmall" tone="muted" style={{ textAlign: 'center', maxWidth: 300 }}>
        Your data is safe. Try again — if it keeps happening, tell us what you were doing.
      </AppText>
      <AppText variant="caption" tone="muted" style={{ textAlign: 'center', maxWidth: 300 }}>
        {error.message}
      </AppText>
      <Pressable
        onPress={() => void retry()}
        style={({ pressed }) => ({
          paddingHorizontal: theme.spacing.xxl,
          paddingVertical: theme.spacing.md,
          borderRadius: theme.radius.full,
          backgroundColor: theme.colors.accent.base,
          opacity: pressed ? 0.8 : 1,
        })}>
        <AppText variant="bodyMedium" style={{ color: theme.colors.accent.on }}>
          Try again
        </AppText>
      </Pressable>
    </View>
  );
}
