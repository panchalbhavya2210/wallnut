import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/theme/theme';
import { Card, ListGroup, ListRow, Row, ScrollScreen, ScreenHeader } from '@/components/ui/layout';
import { AppText } from '@/components/ui/text';
import { Button, Chip } from '@/components/ui/controls';
import { EmptyState, InfoBanner, LoadingBlock } from '@/components/ui/feedback';
import { Field, FormSheet } from '@/components/ui/sheets';
import { confirm } from '@/components/ui/confirm';
import { useQuery } from '@/hooks/useQuery';
import { toast } from '@/stores/ui.store';
import { deleteMerchantAlias, listMerchantAliases, upsertMerchantAlias } from '@/services/merchant.service';
import { getTopMerchants } from '@/services/analytics.service';
import { getPeriodRange } from '@/utils/date';
import type { MerchantAlias } from '@/db/schema';

/**
 * Merchant normalisation. Raw strings like "AMZN Mktp IN" and "Amazon Pay
 * India" collapse into one canonical merchant, which cleans up reports, rules,
 * search and subscription detection.
 */
export default function MerchantsScreen() {
  const theme = useTheme();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<MerchantAlias | null>(null);
  const [pattern, setPattern] = useState('');
  const [displayName, setDisplayName] = useState('');

  const query = useQuery(async () => {
    const [aliases, merchants] = await Promise.all([
      listMerchantAliases(),
      getTopMerchants({ range: getPeriodRange('6m', {}) }, 25),
    ]);
    return { aliases, merchants };
  }, []);

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
        subtitle="One canonical name per shop, no matter how the bank writes it"
        hint={{ id: 'merchants', message: 'Banks write the same shop ten ways. Map messy names to one canonical merchant — aliases apply to imports and history.' }}
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

      {query.loading && !query.data ? (
        <LoadingBlock label="Loading merchants…" />
      ) : (
        <View style={{ gap: theme.spacing.lg }}>
          <InfoBanner message="Patterns match anywhere in the raw merchant string (case-insensitive). The longest matching pattern wins, so add specific patterns for tricky names." />

          <ListGroup title="Aliases">
            {(query.data?.aliases ?? []).map((alias) => (
              <ListRow
                key={alias.id}
                title={alias.displayName}
                subtitle={`matches "${alias.pattern}"`}
                icon="storefront-outline"
                iconColor={theme.colors.accent.base}
                onPress={() => {
                  setEditing(alias);
                  setPattern(alias.pattern);
                  setDisplayName(alias.displayName);
                  setEditorOpen(true);
                }}
                right={
                  <Pressable onPress={() => remove(alias)} hitSlop={8}>
                    <Ionicons name="trash-outline" size={16} color={theme.colors.muted} />
                  </Pressable>
                }
              />
            ))}
            {(query.data?.aliases.length ?? 0) === 0 ? (
              <View style={{ padding: theme.spacing.lg }}>
                <AppText variant="bodySmall" tone="muted">
                  No aliases yet — add one to group messy merchant strings.
                </AppText>
              </View>
            ) : null}
          </ListGroup>

          <View>
            <AppText variant="label" tone="muted" style={{ marginBottom: theme.spacing.sm }}>
              TOP MERCHANTS (AFTER GROUPING)
            </AppText>
            {(query.data?.merchants ?? []).length === 0 ? (
              <EmptyState icon="storefront-outline" title="No merchant data" message="Record a few merchant names to see them here." />
            ) : (
              <Card padded={false}>
                {(query.data?.merchants ?? []).map((merchant, index) => (
                  <View
                    key={merchant.name}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingHorizontal: theme.spacing.lg,
                      paddingVertical: theme.spacing.md,
                      borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                      borderTopColor: theme.colors.border,
                    }}>
                    <View style={{ flex: 1, marginRight: 12 }}>
                      <AppText variant="bodySmall" numberOfLines={1}>
                        {merchant.name}
                      </AppText>
                      <AppText variant="caption" tone="muted">
                        {merchant.count}× · avg {formatAvg(merchant.average)}
                      </AppText>
                    </View>
                    <Button
                      label="Alias"
                      size="sm"
                      variant="ghost"
                      onPress={() => {
                        setEditing(null);
                        setPattern(merchant.name.toLowerCase());
                        setDisplayName(merchant.name);
                        setEditorOpen(true);
                      }}
                    />
                  </View>
                ))}
              </Card>
            )}
          </View>
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
          Example: patterns "amzn", "amazon" and "amazon pay" can all display as “Amazon”.
        </AppText>
      </FormSheet>
    </ScrollScreen>
  );
}

function formatAvg(minor: number): string {
  return `₹${(minor / 100).toFixed(0)}`;
}

export const MerchantScreenStyles = StyleSheet.create({ hidden: { display: 'none' } });
