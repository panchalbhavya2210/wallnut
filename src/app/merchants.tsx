import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { Card, Row, ScrollScreen, ScreenHeader } from '@/components/ui/layout';
import { AppText } from '@/components/ui/text';
import { Button } from '@/components/ui/controls';
import { EmptyState, InfoBanner, LoadingBlock } from '@/components/ui/feedback';
import { Field, FormSheet } from '@/components/ui/sheets';
import { confirm } from '@/components/ui/confirm';
import { PeriodChips } from '@/components/PeriodPicker';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { useSettingsStore } from '@/stores/settings.store';
import { toast } from '@/stores/ui.store';
import { deleteMerchantAlias, listMerchantAliases, upsertMerchantAlias } from '@/services/merchant.service';
import { getMerchantOverview } from '@/services/analytics.service';
import { getPeriodRange, type PeriodPreset } from '@/utils/date';
import { formatPercent } from '@/utils/money';
import type { MerchantAlias } from '@/db/schema';

/**
 * Merchant normalisation. Raw strings like "AMZN Mktp IN" and "Amazon Pay
 * India" collapse into one canonical merchant, which cleans up reports, rules,
 * search and subscription detection.
 */
export default function MerchantsScreen() {
  const theme = useTheme();
  const money = useMoney();
  const monthStartDay = useSettingsStore((state) => state.general.monthStartDay);
  const [period, setPeriod] = useState<PeriodPreset>('6m');
  const [search, setSearch] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<MerchantAlias | null>(null);
  const [pattern, setPattern] = useState('');
  const [displayName, setDisplayName] = useState('');

  const range = useMemo(() => getPeriodRange(period, { monthStartDay }), [period, monthStartDay]);

  const query = useQuery(async () => {
    const [aliases, merchants] = await Promise.all([
      listMerchantAliases(),
      getMerchantOverview({ range }, 100),
    ]);
    return { aliases, merchants };
  }, [range.start.getTime(), range.end.getTime()]);

  const visibleMerchants = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = query.data?.merchants.rows ?? [];
    return needle ? rows.filter((row) => row.name.toLowerCase().includes(needle)) : rows;
  }, [query.data?.merchants.rows, search]);

  const save = async () => {
    try {
      await upsertMerchantAlias(pattern, displayName);
      setEditorOpen(false);
      toast.success('Merchant alias saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save');
    }
  };

  const remove = async (alias: MerchantAlias) => {
    const ok = await confirm({ title: `Remove "${alias.pattern}"?`, message: 'Raw merchant names will show again in reports.', tone: 'danger', confirmLabel: 'Remove' });
    if (!ok) return;
    await deleteMerchantAlias(alias.id);
    toast.show('Alias removed');
  };

  return (
    <ScrollScreen>
      <ScreenHeader
        title="Merchants"
        subtitle="Where your money goes — and how bank names are cleaned up"
        hint={{ id: 'merchants', message: 'A merchant is the shop or recipient (Amazon, Swiggy). A category is what the money was for (groceries, dining). Merchant aliases merge messy bank descriptions into one name.' }}
        right={
          <Button
            label="Add alias"
            size="sm"
            variant="secondary"
            onPress={() => {
              setEditing(null);
              setPattern('');
              setDisplayName('');
              setEditorOpen(true);
            }}
          />
        }
      />

      <PeriodChips value={period} onChange={setPeriod} options={['30d', '3m', '6m', '1y', 'all']} style={{ marginBottom: theme.spacing.md }} />

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.sm,
          backgroundColor: theme.colors.inputBackground,
          borderRadius: theme.radius.full,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          paddingHorizontal: theme.spacing.md,
          height: 42,
          marginBottom: theme.spacing.lg,
        }}>
        <Ionicons name="search-outline" size={16} color={theme.colors.muted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search merchants…"
          placeholderTextColor={theme.colors.muted}
          autoCorrect={false}
          style={{ flex: 1, color: theme.colors.text, fontFamily: theme.typography.body.fontFamily, fontSize: 15, paddingVertical: 0 }}
        />
        {search ? (
          <Pressable onPress={() => setSearch('')} hitSlop={8} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={16} color={theme.colors.muted} />
          </Pressable>
        ) : null}
      </View>

      {query.loading && !query.data ? (
        <LoadingBlock label="Loading merchants…" />
      ) : (
        <View style={{ gap: theme.spacing.lg }}>
          <View style={{ gap: theme.spacing.sm }}>
            <Row justify="space-between">
              <AppText variant="titleSmall">Spending by merchant</AppText>
              <AppText variant="caption" tone="muted">
                {formatPercent(
                  (query.data?.merchants.attributedSpending ?? 0) / Math.max(1, query.data?.merchants.totalSpending ?? 1) * 100,
                  0,
                )}{' '}
                attributed
              </AppText>
            </Row>
            {visibleMerchants.length === 0 ? (
              <EmptyState
                icon="storefront-outline"
                title={search ? 'No matching merchants' : 'No merchant data yet'}
                message={
                  search
                    ? 'Try a different name or clear the search.'
                    : 'Add a merchant name when you record a transaction, then it appears here with its spending history.'
                }
              />
            ) : (
              <Card padded={false}>
                {visibleMerchants.map((merchant, index) => (
                  <Pressable
                    key={merchant.name}
                    onPress={() => router.push(`/merchant/${encodeURIComponent(merchant.name)}` as never)}
                    android_ripple={{ color: theme.colors.ripple }}
                    accessibilityRole="button"
                    accessibilityLabel={`${merchant.name}, ${money.format(merchant.total)} across ${merchant.count} transactions`}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: theme.spacing.md,
                      paddingHorizontal: theme.spacing.lg,
                      paddingVertical: theme.spacing.md,
                      borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                      borderTopColor: theme.colors.border,
                    }}>
                    <View
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: theme.radius.full,
                        backgroundColor: theme.colors.accent.soft,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                      <AppText variant="numericCaption" tone="accent">
                        {index + 1}
                      </AppText>
                    </View>
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <AppText variant="bodySmall" numberOfLines={1}>
                        {merchant.name}
                      </AppText>
                      <AppText variant="caption" tone="muted" numberOfLines={1}>
                        {merchant.count} transaction{merchant.count === 1 ? '' : 's'} · avg {money.format(merchant.average)} ·{' '}
                        {formatPercent(merchant.share, 1)} of spending
                      </AppText>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 2 }}>
                      <AppText variant="numericCaption">{money.format(merchant.total)}</AppText>
                      <Ionicons name="chevron-forward" size={14} color={theme.colors.muted} />
                    </View>
                  </Pressable>
                ))}
              </Card>
            )}
            {query.data && query.data.merchants.unattributedSpending > 0 ? (
              <AppText variant="caption" tone="muted">
                {money.format(query.data.merchants.unattributedSpending)} of spending has no merchant name. Add a merchant when recording those transactions to include them here.
              </AppText>
            ) : null}
          </View>

          <Card>
            <AppText variant="titleSmall" style={{ marginBottom: theme.spacing.xs }}>
              Merchant name cleanup
            </AppText>
            <AppText variant="caption" tone="muted" style={{ marginBottom: theme.spacing.md }}>
              Banks write the same shop many ways. An alias maps a raw pattern to one display name everywhere, including history.
            </AppText>
            {(query.data?.aliases.length ?? 0) === 0 ? (
              <AppText variant="bodySmall" tone="muted">
                No aliases yet — add one to group messy merchant strings.
              </AppText>
            ) : (
              (query.data?.aliases ?? []).map((alias, index) => (
                <Pressable
                  key={alias.id}
                  onPress={() => {
                    setEditing(alias);
                    setPattern(alias.pattern);
                    setDisplayName(alias.displayName);
                    setEditorOpen(true);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit alias for ${alias.pattern}`}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.md,
                    paddingVertical: theme.spacing.md,
                    borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                    borderTopColor: theme.colors.border,
                  }}>
                  <Ionicons name="pricetag-outline" size={16} color={theme.colors.muted} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <AppText variant="bodySmall" numberOfLines={1}>
                      {alias.displayName}
                    </AppText>
                    <AppText variant="caption" tone="muted" numberOfLines={1}>
                      matches “{alias.pattern}”
                    </AppText>
                  </View>
                  <Pressable onPress={() => void remove(alias)} hitSlop={10} accessibilityLabel={`Delete alias ${alias.pattern}`}>
                    <Ionicons name="trash-outline" size={16} color={theme.colors.muted} />
                  </Pressable>
                </Pressable>
              ))
            )}
          </Card>

          <InfoBanner message="Patterns match anywhere in the raw merchant string (case-insensitive). The longest matching pattern wins, so add specific patterns for tricky names." />
        </View>
      )}

      <FormSheet
        visible={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editing ? 'Edit alias' : 'New merchant alias'}
        submitLabel="Save alias"
        onSubmit={save}
        destructive={Boolean(editing)}
        onDelete={editing ? () => { setEditorOpen(false); void remove(editing); } : undefined}>
        <Field label="Pattern (lowercase text to match)" value={pattern} onChangeText={setPattern} placeholder="e.g. amzn" autoFocus />
        <Field label="Display name" value={displayName} onChangeText={setDisplayName} placeholder="e.g. Amazon" />
        <AppText variant="caption" tone="muted">
          Example: patterns “amzn”, “amazon” and “amazon pay” can all display as “Amazon”.
        </AppText>
      </FormSheet>
    </ScrollScreen>
  );
}

export const MerchantScreenStyles = StyleSheet.create({ hidden: { display: 'none' } });
