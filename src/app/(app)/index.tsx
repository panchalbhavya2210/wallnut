import React, { useCallback } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, type ErrorBoundaryProps } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { ScrollScreen, Row, SectionHeader } from '@/components/ui/layout';
import { AppText } from '@/components/ui/text';
import { IconButton } from '@/components/ui/controls';
import { HeaderMenuButton } from '@/components/HeaderMenuButton';
import { AccountScopeRow } from '@/components/AccountScope';
import { AiInsightCard } from '@/components/AiInsightCard';
import { WidgetBoundary } from '@/components/WidgetBoundary';
import { EmptyState, ErrorBlock, LoadingBlock } from '@/components/ui/feedback';
import { renderWidget } from '@/components/widgets';
import { PeriodChips } from '@/components/PeriodPicker';
import { useQuery, useNow } from '@/hooks/useQuery';
import { useUiStore } from '@/stores/ui.store';
import { useSettingsStore } from '@/stores/settings.store';
import { getDb } from '@/db/client';
import { dashboardWidgets, transactions as transactionsTable, accounts as accountsTable } from '@/db/schema';
import { asc, eq, sql } from 'drizzle-orm';
import type { DashboardWidget } from '@/db/schema';
import { getReviewQueue } from '@/services/review.service';

/**
 * Home — the financial command centre. Widgets are stored in the database and
 * rendered in their configured order; each widget owns its own filters.
 */
export default function HomeScreen() {
  const theme = useTheme();
  const now = useNow();
  const userName = useSettingsStore((state) => state.general.userName);
  const density = useSettingsStore((state) => state.dashboard.density);
  const defaultPeriod = useSettingsStore((state) => state.dashboard.defaultPeriod);
  const updateDashboard = useSettingsStore((state) => state.update);
  const scopeAccountId = useUiStore((state) => state.accountScopeId);
  const hideAmounts = useSettingsStore((state) => state.security.hideAmounts);
  const updateSettings = useSettingsStore((state) => state.update);
  const [, setRefreshing] = React.useState(false);

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

  const greeting = getGreeting(now);

  if (widgets.error) {
    return (
      <ScrollScreen>
        <Header
          greeting={greeting}
          date={now}
          hidden={hideAmounts}
          onTogglePrivacy={() => updateSettings('security', { hideAmounts: !hideAmounts })}
        />
        <ErrorBlock message={widgets.error.message} onRetry={widgets.refresh} />
      </ScrollScreen>
    );
  }

  return (
    <ScrollScreen
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={() => {
            setRefreshing(true);
            refresh();
            setTimeout(() => setRefreshing(false), 400);
          }}
          tintColor={theme.colors.muted}
        />
      }>
      <Header
        greeting={greeting}
        date={now}
        reviewCount={widgets.data?.reviewCount ?? 0}
        onReview={() => navigate('/review')}
        hidden={hideAmounts}
        onTogglePrivacy={() => updateSettings('security', { hideAmounts: !hideAmounts })}
      />

      {widgets.loading && !widgets.data ? (
        <LoadingBlock label="Opening your ledger…" />
      ) : widgets.data?.isEmpty ? (        <View style={{ marginTop: theme.spacing.xl }}>
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
        <View style={{ gap: density === 'compact' ? theme.spacing.lg : theme.spacing.xxl, marginTop: theme.spacing.sm }}>
          <View style={{ marginTop: theme.spacing.lg }}>
            <WidgetBoundary>
              <AccountScopeRow />
            </WidgetBoundary>
          </View>
          <PeriodChips
            value={defaultPeriod}
            onChange={(period) => updateDashboard('dashboard', { defaultPeriod: period })}
            options={['7d', '30d', 'thisMonth', 'lastMonth', '3m', '1y']}
            compact
          />
          <WidgetBoundary>
            <AiInsightCard />
          </WidgetBoundary>
          {packWidgets(widgets.data?.widgets ?? []).map((row, index) => (
            <View key={`row-${index}`} style={{ flexDirection: 'row', gap: theme.spacing.md, alignItems: 'flex-start' }}>
              {row.map((widget) => (
                <View key={widget.id} style={{ flex: 1, minWidth: 0 }}>
                  <WidgetBoundary key={widget.id}>{renderWidget(widget, navigate, scopeAccountId)}</WidgetBoundary>
                </View>
              ))}
            </View>
          ))}
          <View style={{ marginTop: theme.spacing.sm }}>
            <SectionHeader
              title="Dashboard"
              actionLabel="Customize"
              onAction={() => navigate('/settings/dashboard')}
            />
          </View>
        </View>
      )}
    </ScrollScreen>
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

function Header({
  greeting,
  date,
  reviewCount,
  onReview,
  hidden,
  onTogglePrivacy,
}: {
  greeting: string;
  date: Date;
  reviewCount?: number;
  onReview?: () => void;
  hidden?: boolean;
  onTogglePrivacy?: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingTop: theme.spacing.md }}>
      <HeaderMenuButton size={24} />
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="caption" tone="muted">
          {date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
        </AppText>
        <AppText variant="title">{greeting}</AppText>
      </View>
      {onTogglePrivacy ? (
        <IconButton
          icon={hidden ? 'eye-off-outline' : 'eye-outline'}
          onPress={onTogglePrivacy}
          accessibilityLabel={hidden ? 'Show amounts' : 'Hide amounts'}
          color={hidden ? theme.colors.accent.base : undefined}
        />
      ) : null}
      {reviewCount && reviewCount > 0 ? (
        <IconButton icon="checkmark-done-outline" onPress={onReview} accessibilityLabel={`${reviewCount} to review`} />
      ) : null}
    </View>
  );
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
