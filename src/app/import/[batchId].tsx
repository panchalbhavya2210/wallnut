import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { Card, IconName, Row, ScrollScreen, ScreenHeader } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { Button, Chip } from '@/components/ui/controls';
import { EmptyState, ErrorBlock, InfoBanner, LoadingBlock } from '@/components/ui/feedback';
import { BottomSheet, DatePickerSheet, Field, PickerSheet } from '@/components/ui/sheets';
import { confirm } from '@/components/ui/confirm';
import { useQuery } from '@/hooks/useQuery';
import { toast } from '@/stores/ui.store';
import { buildCategoryTree, listCategories } from '@/services/categories.service';
import {
  abandonImportBatch,
  confirmImportDrafts,
  getImportBatchBundle,
  rememberMerchantForCategory,
  skipImportDrafts,
  updateImportDraft,
} from '@/services/import/staging.service';
import type { ImportDraft } from '@/db/schema';
import { formatDayMonth } from '@/utils/date';

/**
 * Statement review — the step between a file and the ledger.
 *
 * One card per staged draft: date, the bank's raw text, best-effort merchant,
 * amount, suggested category (explained as "from your rule" when merchant
 * memory provided it), a note prompt, skip and Later. Nothing was written when
 * the file was read; only the rows confirmed here reach the ledger.
 */
export default function ImportReviewScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ batchId: string }>();
  const batchId = typeof params.batchId === 'string' ? params.batchId : '';

  const query = useQuery(async () => {
    const [bundle, categories] = await Promise.all([getImportBatchBundle(batchId), listCategories()]);
    return { bundle, categories };
  }, [batchId]);

  // Explicit user overrides of the default inclusion (pending + not a duplicate).
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<ImportDraft | null>(null);
  const [sheet, setSheet] = useState<'none' | 'category' | 'date'>('none');

  const bundle = query.data?.bundle ?? null;
  const drafts = useMemo(() => query.data?.bundle?.drafts ?? [], [query.data?.bundle?.drafts]);
  const categories = useMemo(() => query.data?.categories ?? [], [query.data?.categories]);

  const isIncluded = (draft: ImportDraft): boolean =>
    overrides[draft.id] ?? !draft.duplicateOf;

  const included = useMemo(
    () => drafts.filter((draft) => draft.status === 'pending' && (overrides[draft.id] ?? !draft.duplicateOf)),
    [drafts, overrides],
  );
  const pendingCount = drafts.filter((draft) => draft.status === 'pending').length;
  const resolvedCount = drafts.filter((draft) => draft.status !== 'pending').length;
  const duplicatesSkipped = drafts.filter((draft) => draft.status === 'pending' && draft.duplicateOf && !isIncluded(draft)).length;
  const categoryById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);

  const refresh = query.refresh;

  /** Deep links have no history to pop; fall back to the dashboard. */
  const leave = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/' as never);
  };

  /* --------------------------------- Actions -------------------------------- */

  const confirmSelected = async () => {
    if (included.length === 0) return;
    setBusy(true);
    try {
      // Rows left unchecked *because* they look like duplicates are skipped —
      // the warning already told the user they would be left out. Rows the
      // user unticked deliberately stay staged for Later.
      const duplicateIds = drafts
        .filter((draft) => draft.status === 'pending' && draft.duplicateOf && !isIncluded(draft))
        .map((draft) => draft.id);
      const confirmedIds = included.map((draft) => draft.id);

      const inserted = await confirmImportDrafts(confirmedIds);
      if (duplicateIds.length > 0) await skipImportDrafts(duplicateIds);
      const remaining = pendingCount - confirmedIds.length - duplicateIds.length;

      toast.success(`${inserted} transaction${inserted === 1 ? '' : 's'} added to your ledger`, {
        title: 'Import complete',
      });
      if (remaining <= 0) {
        leave();
      } else {
        refresh();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save these rows');
    } finally {
      setBusy(false);
    }
  };

  const skipAllDuplicates = async () => {
    const ids = drafts.filter((draft) => draft.status === 'pending' && draft.duplicateOf).map((draft) => draft.id);
    if (ids.length === 0) return;
    setBusy(true);
    try {
      await skipImportDrafts(ids);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const abandon = async () => {
    const ok = await confirm({
      title: 'Abandon this import?',
      message: 'Every staged row and the statement data behind it are deleted. Nothing has reached your ledger yet.',
      confirmLabel: 'Delete & abandon',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await abandonImportBatch(batchId);
      toast.show('Import abandoned');
      leave();
    } finally {
      setBusy(false);
    }
  };

  const saveEdits = async (draft: ImportDraft, patch: Parameters<typeof updateImportDraft>[1], remember: boolean) => {
    setBusy(true);
    try {
      await updateImportDraft(draft.id, patch);
      if (remember && patch.categoryId && draft.merchant) {
        await rememberMerchantForCategory({ merchant: draft.merchant, categoryId: patch.categoryId, rawMerchant: draft.rawDescription });
        toast.success(`Wallnut will suggest this for “${draft.merchant}”`);
      }
      setEditing(null);
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the row');
    } finally {
      setBusy(false);
    }
  };

  const skipOne = async (draft: ImportDraft) => {
    setBusy(true);
    try {
      await skipImportDrafts([draft.id]);
      setEditing(null);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  /* ----------------------------------- UI ----------------------------------- */

  if (query.loading && !query.data) {
    return (
      <ScrollScreen>
        <ScreenHeader title="Review transactions" subtitle="Opening the staged rows…" />
        <LoadingBlock />
      </ScrollScreen>
    );
  }

  if (query.error) {
    return (
      <ScrollScreen>
        <ScreenHeader title="Review transactions" />
        <ErrorBlock message={query.error.message} onRetry={refresh} />
      </ScrollScreen>
    );
  }

  if (!bundle) {
    return (
      <ScrollScreen>
        <ScreenHeader title="Review transactions" />
        <EmptyState
          icon="checkmark-done-outline"
          title="This import is finished"
          message="There is nothing left to review — the batch was completed or deleted. Your ledger only received the rows you confirmed."
          actionLabel="Back"
          onAction={leave}
        />
      </ScrollScreen>
    );
  }

  const subtitle =
    bundle.batch.status === 'committed'
      ? 'Import complete'
      : `${resolvedCount} of ${drafts.length} reviewed · nothing is in your ledger yet`;

  return (
    <ScrollScreen>
      <ScreenHeader title="Review transactions" subtitle={subtitle} />

      {drafts.length === 0 ? (
        <EmptyState
          icon="checkmark-circle-outline"
          title="Import complete"
          message={`${bundle.batch.confirmedRows} transaction${bundle.batch.confirmedRows === 1 ? '' : 's'} added · ${bundle.batch.skippedRows} skipped. The staged statement data has been deleted.`}
          actionLabel="Back"
          onAction={leave}
        />
      ) : (
        <View style={{ gap: theme.spacing.lg }}>
          <Row gap="sm">
            <StatPill label="Waiting" value={pendingCount} tone="accent" />
            <StatPill label="Duplicates" value={bundle.batch.duplicateRows} tone="warning" />
            <StatPill label="Unreadable" value={bundle.batch.invalidRows} tone="negative" />
          </Row>

          <InfoBanner
            message={`These rows came from ${bundle.batch.fileName ?? `a ${bundle.batch.source.toUpperCase()} file`}. Confirm only what belongs in your ledger — duplicates are detected by fingerprint and left unchecked.`}
          />

          {duplicatesSkipped > 0 ? (
            <Row justify="space-between">
              <AppText variant="caption" tone="muted">
                {duplicatesSkipped} possible duplicate{duplicatesSkipped === 1 ? '' : 's'} skipped
              </AppText>
              <AppText variant="captionMedium" tone="accent" onPress={skipAllDuplicates}>
                Clear them
              </AppText>
            </Row>
          ) : null}

          <View style={{ gap: theme.spacing.md }}>
            {drafts.map((draft) => {
              const checked = isIncluded(draft);
              const category = (draft.categoryId ?? draft.suggestedCategoryId)
                ? categoryById.get(draft.categoryId ?? draft.suggestedCategoryId ?? '')
                : null;
              const isSuggestionOnly = !draft.categoryId && Boolean(draft.suggestedCategoryId);
              return (
                <Pressable
                  key={draft.id}
                  onPress={() => !busy && setOverrides((current) => ({ ...current, [draft.id]: !checked }))}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked }}
                  style={({ pressed }) => ({
                    backgroundColor: theme.colors.surface,
                    borderRadius: theme.radius.lg,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: checked ? theme.colors.accent.base : theme.colors.border,
                    opacity: draft.status === 'pending' ? 1 : 0.55,
                    padding: theme.spacing.md,
                    flexDirection: 'row',
                    gap: theme.spacing.md,
                    alignItems: 'flex-start',
                    ...(pressed ? { backgroundColor: theme.colors.pressed } : null),
                  })}>
                  <Ionicons
                    name={checked ? 'checkmark-circle' : 'ellipse-outline'}
                    size={24}
                    color={checked ? theme.colors.accent.base : theme.colors.muted}
                    style={{ marginTop: 2 }}
                  />
                  <View style={{ flex: 1, gap: 3 }}>
                    <Row justify="space-between">
                      <AppText variant="bodyMedium" numberOfLines={1} style={{ flex: 1 }}>
                        {draft.merchant || draft.rawDescription || 'Statement row'}
                      </AppText>
                      {draft.amount !== null ? (
                        <MoneyText amount={draft.amount} variant="numericSmall" tone="neutral" />
                      ) : null}
                    </Row>
                    <AppText variant="caption" tone="muted" numberOfLines={1}>
                      {draft.date ? formatDayMonth(new Date(draft.date)) : 'No date'}
                      {category ? ` · ${category.name}` : ' · Uncategorised'}
                      {draft.merchant && draft.rawDescription && draft.rawDescription !== draft.merchant
                        ? ` · “${draft.rawDescription}”`
                        : ''}
                    </AppText>
                    <Row gap="sm" wrap style={{ marginTop: 2 }}>
                      {draft.status !== 'pending' ? (
                        <Chip label={draft.status === 'confirmed' ? 'Saved' : 'Skipped'} selected={draft.status === 'confirmed'} />
                      ) : null}
                      {draft.duplicateOf ? <Chip label="Possible duplicate" /> : null}
                      {isSuggestionOnly && draft.suggestedRuleName ? (
                        <Chip label={`From “${draft.suggestedRuleName}”`} />
                      ) : null}
                    </Row>
                  </View>
                  {draft.status === 'pending' ? (
                    <Pressable
                      onPress={() => setEditing(draft)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Edit this row"
                      style={{ padding: 2 }}>
                      <Ionicons name="create-outline" size={18} color={theme.colors.textSecondary} />
                    </Pressable>
                  ) : null}
                </Pressable>
              );
            })}
          </View>

          <View style={{ gap: theme.spacing.sm }}>
            <Button
              label={
                included.length === 0
                  ? 'Nothing selected'
                  : `Add ${included.length} transaction${included.length === 1 ? '' : 's'}`
              }
              size="lg"
              fullWidth
              loading={busy}
              disabled={included.length === 0}
              onPress={() => void confirmSelected()}
            />
            <AppText variant="caption" tone="muted" style={{ textAlign: 'center' }}>
              {duplicatesSkipped > 0
                ? `${duplicatesSkipped} possible duplicate${duplicatesSkipped === 1 ? '' : 's'} will be left out`
                : 'Only the checked rows are written — the staged statement data is deleted afterwards'}
            </AppText>
            <Row justify="center" gap="lg">
              <AppText variant="captionMedium" tone="accent" onPress={leave}>
                Later
              </AppText>
              <AppText variant="captionMedium" tone="negative" onPress={() => void abandon()}>
                Abandon import
              </AppText>
            </Row>
          </View>
        </View>
      )}

      {/* ------------------------------ Edit sheet ------------------------------ */}
      {editing ? (
        <DraftEditSheet
          draft={editing}
          categoryName={
            (editing.categoryId ?? editing.suggestedCategoryId)
              ? (categoryById.get(editing.categoryId ?? editing.suggestedCategoryId ?? '')?.name ?? 'None')
              : 'Uncategorised'
          }
          onClose={() => setEditing(null)}
          onPickCategory={() => setSheet('category')}
          onPickDate={() => setSheet('date')}
          onSubmit={(patch, remember) => void saveEdits(editing, patch, remember)}
          onSkip={() => void skipOne(editing)}
          busy={busy}
        />
      ) : null}

      <PickerSheet
        visible={sheet === 'category' && Boolean(editing)}
        onClose={() => setSheet('none')}
        title="Choose category"
        selectedId={editing?.categoryId ?? editing?.suggestedCategoryId ?? null}
        items={buildCategoryTree(categories).flatMap((parent) => [
          { id: parent.id, label: parent.name, icon: parent.icon as IconName, color: parent.color },
          ...parent.children.map((child) => ({
            id: child.id,
            label: child.name,
            icon: child.icon as IconName,
            color: child.color,
            section: parent.name,
          })),
        ])}
        onSelect={(item) => {
          if (!editing) return;
          // Keep the sheet open so the "remember" choice is made together.
          setEditing({ ...editing, categoryId: item.id });
          setSheet('none');
        }}
      />

      <DatePickerSheet
        visible={sheet === 'date' && Boolean(editing)}
        onClose={() => setSheet('none')}
        value={editing?.date ? new Date(editing.date) : new Date()}
        onSelect={(date) => {
          if (!editing) return;
          setEditing({
            ...editing,
            date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
          });
          setSheet('none');
        }}
      />
    </ScrollScreen>
  );
}

/* ------------------------------ Draft edit sheet ----------------------------- */

function DraftEditSheet({
  draft,
  categoryName,
  onClose,
  onPickCategory,
  onPickDate,
  onSubmit,
  onSkip,
  busy,
}: {
  draft: ImportDraft;
  categoryName: string;
  onClose: () => void;
  onPickCategory: () => void;
  onPickDate: () => void;
  onSubmit: (
    patch: { categoryId?: string | null; date?: string; merchant?: string | null; notes?: string | null; type?: 'expense' | 'income' | 'refund' | 'adjustment' },
    remember: boolean,
  ) => void;
  onSkip: () => void;
  busy: boolean;
}) {
  const theme = useTheme();
  const [merchant, setMerchant] = useState(draft.merchant ?? '');
  const [notes, setNotes] = useState(draft.notes ?? '');
  const [type, setType] = useState<'expense' | 'income' | 'refund' | 'adjustment'>(
    draft.type === 'income' || draft.type === 'refund' || draft.type === 'adjustment' ? draft.type : 'expense',
  );
  const [remember, setRemember] = useState(false);

  const rememberable = Boolean(draft.merchant) && Boolean(draft.categoryId ?? draft.suggestedCategoryId);

  return (
    <BottomSheet visible onClose={onClose} title="Edit this row" footer={
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        <Button label="Skip row" variant="secondary" onPress={onSkip} style={{ flex: 1 }} />
        <Button
          label="Save changes"
          loading={busy}
          style={{ flex: 2 }}
          onPress={() =>
            onSubmit(
              {
                merchant: merchant.trim() || null,
                notes: notes.trim() || null,
                type,
                categoryId: draft.categoryId ?? draft.suggestedCategoryId ?? null,
                date: draft.date ?? undefined,
              },
              remember,
            )
          }
        />
      </View>
    }>
      <View style={{ gap: theme.spacing.lg, paddingBottom: theme.spacing.sm }}>
        {draft.rawDescription ? (
          <AppText variant="caption" tone="muted" numberOfLines={2}>
            Statement text: “{draft.rawDescription}”
          </AppText>
        ) : null}

        <Field label="Merchant" value={merchant} onChangeText={setMerchant} placeholder="Merchant name" />

        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="label" tone="muted">
            TYPE
          </AppText>
          <Row gap="sm">
            {(['expense', 'income', 'refund'] as const).map((option) => (
              <Chip key={option} label={option === 'expense' ? 'Expense' : option === 'income' ? 'Income' : 'Refund'} selected={type === option} onPress={() => setType(option)} />
            ))}
          </Row>
        </View>

        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="label" tone="muted">
            DATE
          </AppText>
          <Row justify="space-between">
            <AppText variant="bodyMedium">{draft.date ? formatDayMonth(new Date(draft.date)) : 'No date'}</AppText>
            <AppText variant="captionMedium" tone="accent" onPress={onPickDate}>
              Change
            </AppText>
          </Row>
        </View>

        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="label" tone="muted">
            CATEGORY
          </AppText>
          <Row justify="space-between">
            <AppText variant="bodyMedium">{categoryName}</AppText>
            <AppText variant="captionMedium" tone="accent" onPress={onPickCategory}>
              Change
            </AppText>
          </Row>
        </View>

        <Field label="Note (optional)" value={notes} onChangeText={setNotes} placeholder="Add context for later" />

        {rememberable ? (
          <Pressable onPress={() => setRemember((value) => !value)} accessibilityRole="checkbox" accessibilityState={{ checked: remember }}>
            <Card style={{ borderColor: remember ? theme.colors.accent.base : theme.colors.border }}>
              <Row gap="sm">
                <Ionicons name={remember ? 'checkbox-outline' : 'square-outline'} size={20} color={remember ? theme.colors.accent.base : theme.colors.muted} />
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="bodySmall">Always suggest this category</AppText>
                  <AppText variant="caption" tone="muted">
                    Saves a rule for “{draft.merchant}” — future imports preselect it and say where it came from. It never applies silently.
                  </AppText>
                </View>
              </Row>
            </Card>
          </Pressable>
        ) : null}
      </View>
    </BottomSheet>
  );
}

/* --------------------------------- Small UI --------------------------------- */

function StatPill({ label, value, tone }: { label: string; value: number; tone: 'accent' | 'warning' | 'negative' }) {
  const theme = useTheme();
  const color =
    tone === 'accent' ? theme.colors.accent.base : tone === 'warning' ? theme.colors.warning : theme.colors.negative;
  return (
    <View
      style={{
        flex: 1,
        padding: theme.spacing.md,
        borderRadius: theme.radius.md,
        backgroundColor: `${color}14`,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: `${color}44`,
        alignItems: 'center',
        gap: 2,
      }}>
      <AppText variant="numericSmall" style={{ color }}>
        {value}
      </AppText>
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
    </View>
  );
}
