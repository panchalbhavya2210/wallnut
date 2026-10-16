import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { Screen, IconName } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { Button, Chip, IconButton } from '@/components/ui/controls';
import { EmptyState, ErrorBlock, LoadingBlock } from '@/components/ui/feedback';
import { HeaderMenuButton } from '@/components/HeaderMenuButton';
import { BottomSheet, DatePickerSheet, PickerSheet } from '@/components/ui/sheets';
import { SwipeableRow } from '@/components/ui/SwipeableRow';
import { confirm } from '@/components/ui/confirm';
import { useQuery, useDebouncedValue } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { useSettingsStore } from '@/stores/settings.store';
import { useUiStore, toast } from '@/stores/ui.store';
import { listAccounts, ACCOUNT_TYPE_LABELS } from '@/services/accounts.service';
import { listCategories, buildCategoryTree } from '@/services/categories.service';
import { listTags } from '@/services/tags.service';
import {
  bulkDeleteTransactions,
  bulkUpdateAccount,
  bulkUpdateCategory,
  deleteTransaction,
  listTransactions,
  markReviewed,
  type TransactionFilters,
  type TransactionListItem,
} from '@/services/transactions.service';
import { addTagToTransactions } from '@/services/tags.service';
import { formatDayLabel, fromISODate, toISODate } from '@/utils/date';

/**
 * Transactions — the workhorse screen: instant search, tab filters, advanced
 * filters, date grouping, swipe actions, multi-select bulk editing.
 */

type TabKey = 'all' | 'expenses' | 'income' | 'transfers';

const PAGE_SIZE = 60;

export default function TransactionsScreen() {
  const theme = useTheme();
  const money = useMoney();
  const groupByDate = useSettingsStore((state) => state.transactions.groupByDate);
  const confirmDeletion = useSettingsStore((state) => state.transactions.confirmDeletion);
  const showIcons = useSettingsStore((state) => state.transactions.showIcons);

  const selectionMode = useUiStore((state) => state.selectionMode);
  const selectedIds = useUiStore((state) => state.selectedIds);
  const toggleSelected = useUiStore((state) => state.toggleSelected);
  const setSelectionMode = useUiStore((state) => state.setSelectionMode);
  const clearSelection = useUiStore((state) => state.clearSelection);

  const [tab, setTab] = useState<TabKey>('all');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 220);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<TransactionFilters>({});
  const [page, setPage] = useState(1);
  const [searchOpen, setSearchOpen] = useState(false);

  const tabFilters: TransactionFilters = useMemo(() => {
    switch (tab) {
      case 'expenses':
        return { types: ['expense', 'refund'], includeRefunds: true };
      case 'income':
        return { types: ['income'] };
      case 'transfers':
        return { types: ['transfer'] };
      default:
        return { includeTransfers: true, includeRefunds: true, includeAdjustments: true, includeDebtActivity: true };
    }
  }, [tab]);

  const effectiveFilters: TransactionFilters = useMemo(
    () => ({
      ...tabFilters,
      ...filters,
      search: debouncedSearch || undefined,
      limit: PAGE_SIZE * page,
      offset: 0,
      sort: 'date_desc',
    }),
    [tabFilters, filters, debouncedSearch, page],
  );

  const query = useQuery(() => listTransactions(effectiveFilters), [
    JSON.stringify(effectiveFilters),
  ]);

  const totalCount = useQuery(() => import('@/services/transactions.service').then((m) => m.countTransactions({ ...tabFilters, search: debouncedSearch || undefined })), [JSON.stringify(tabFilters), debouncedSearch]);

  useFocusEffect(
    useCallback(() => {
      setPage(1);
      return () => undefined;
    }, []),
  );

  const rows = query.data ?? [];
  const hasMore = totalCount.data !== null && rows.length < totalCount.data;

  const grouped = useMemo(() => {
    if (!groupByDate) return [{ key: 'all', label: '', data: rows, total: 0 }];
    const map = new Map<string, TransactionListItem[]>();
    for (const row of rows) {
      const bucket = map.get(row.date) ?? [];
      bucket.push(row);
      map.set(row.date, bucket);
    }
    return Array.from(map.entries()).map(([date, items]) => ({
      key: date,
      label: formatDayLabel(fromISODate(date) ?? new Date()),
      data: items,
      total: items.reduce((sum, item) => sum + (item.isTransfer ? 0 : item.amount), 0),
    }));
  }, [rows, groupByDate]);

  const activeFilterCount = countActiveFilters(filters);

  const handleDelete = async (item: TransactionListItem) => {
    if (confirmDeletion) {
      const ok = await confirm({
        title: 'Delete transaction?',
        message: `${item.merchant ?? item.description ?? 'This transaction'} · ${money.format(item.amount)}`,
        confirmLabel: 'Delete',
        tone: 'danger',
      });
      if (!ok) return;
    }
    await deleteTransaction(item.id);
    toast.show('Transaction deleted');
  };

  const handleBulkDelete = async () => {
    const ok = await confirm({
      title: `Delete ${selectedIds.length} transactions?`,
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    await bulkDeleteTransactions(selectedIds);
    clearSelection();
    toast.show(`${selectedIds.length} transactions deleted`);
  };

  return (
    <Screen>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: theme.spacing.md }}>
        {selectionMode ? (
          <>
            <AppText variant="title">{selectedIds.length} selected</AppText>
            <IconButton icon="close" onPress={clearSelection} accessibilityLabel="Exit selection" />
          </>
        ) : (
          <>
            <HeaderMenuButton />
            <View style={{ flex: 1 }}>
              <AppText variant="title">Transactions</AppText>
              {totalCount.data !== null ? (
                <AppText variant="caption" tone="muted">
                  {totalCount.data} record{totalCount.data === 1 ? '' : 's'}
                </AppText>
              ) : null}
            </View>
            <IconButton icon="search-outline" onPress={() => setSearchOpen((value) => !value)} accessibilityLabel="Search" />
            <IconButton
              icon="options-outline"
              onPress={() => setShowFilters(true)}
              accessibilityLabel="Filters"
              color={activeFilterCount > 0 ? theme.colors.accent.base : undefined}
            />
          </>
        )}
      </View>

      {/* Search */}
      {!selectionMode && (searchOpen || search.length > 0) ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.sm,
            backgroundColor: theme.colors.inputBackground,
            borderRadius: theme.radius.md,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
            paddingHorizontal: theme.spacing.md,
            height: 42,
            marginTop: theme.spacing.md,
          }}>
          <Ionicons name="search-outline" size={16} color={theme.colors.muted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search merchant, notes, category, tag…"
            placeholderTextColor={theme.colors.muted}
            autoFocus
            style={{ flex: 1, color: theme.colors.text, fontFamily: theme.typography.body.fontFamily, fontSize: 15, paddingVertical: 0 }}
          />
          {search ? (
            <Pressable onPress={() => setSearch('')} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={theme.colors.muted} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* Tabs */}
      {!selectionMode ? (
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.md, marginBottom: theme.spacing.sm }}>
          {([
            { key: 'all', label: 'All' },
            { key: 'expenses', label: 'Expenses' },
            { key: 'income', label: 'Income' },
            { key: 'transfers', label: 'Transfers' },
          ] as { key: TabKey; label: string }[]).map((entry) => (
            <Chip
              key={entry.key}
              label={entry.label}
              selected={tab === entry.key}
              onPress={() => {
                setTab(entry.key);
                setPage(1);
              }}
            />
          ))}
          {activeFilterCount > 0 ? (
            <Chip
              label={`${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'}`}
              icon="options-outline"
              selected
              onPress={() => setShowFilters(true)}
            />
          ) : null}
        </View>
      ) : null}

      {/* List */}
      {query.loading && rows.length === 0 ? (
        <LoadingBlock label="Loading transactions…" />
      ) : query.error ? (
        <ErrorBlock message={query.error.message} onRetry={query.refresh} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={search || activeFilterCount > 0 ? 'search-outline' : 'receipt-outline'}
          title={search || activeFilterCount > 0 ? 'No matching transactions' : 'No transactions yet'}
          message={
            search || activeFilterCount > 0
              ? 'Try a different search or clear the filters.'
              : 'Tap the + button to record your first transaction.'
          }
          actionLabel={search || activeFilterCount > 0 ? 'Clear filters' : 'Add transaction'}
          onAction={() => {
            if (search || activeFilterCount > 0) {
              setSearch('');
              setFilters({});
            } else {
              router.push('/transaction/new');
            }
          }}
        />
      ) : (
        <FlatList
          data={grouped}
          keyExtractor={(item) => item.key}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 140 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={false} onRefresh={query.refresh} tintColor={theme.colors.muted} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (hasMore && !query.loading) setPage((value) => value + 1);
          }}
          renderItem={({ item: group }) => (
            <View>
              {group.label ? (
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingVertical: theme.spacing.md,
                    backgroundColor: theme.colors.background,
                  }}>
                  <AppText variant="label" tone="muted">
                    {group.label.toUpperCase()}
                  </AppText>
                  <AppText variant="numericCaption" tone="muted">
                    {group.total !== 0 ? money.format(group.total, { sign: 'always' }) : ''}
                  </AppText>
                </View>
              ) : null}
              {group.data.map((row) => (
                <TransactionRow
                  key={row.id}
                  row={row}
                  showIcon={showIcons}
                  selectionMode={selectionMode}
                  selected={selectedIds.includes(row.id)}
                  onPress={() => {
                    if (selectionMode) toggleSelected(row.id);
                    else router.push(`/transaction/${row.id}` as never);
                  }}
                  onLongPress={() => {
                    setSelectionMode(true);
                    toggleSelected(row.id);
                  }}
                  onDelete={() => handleDelete(row)}
                  onEdit={() => router.push(`/transaction/${row.id}?edit=1` as never)}
                  onReviewed={() => {
                    void markReviewed([row.id], !row.isReviewed);
                    toast.show(row.isReviewed ? 'Marked unreviewed' : 'Marked reviewed');
                  }}
                />
              ))}
            </View>
          )}
        />
      )}

      {/* Bulk action bar */}
      {selectionMode && selectedIds.length > 0 ? (
        <BulkActionBar
          ids={selectedIds}
          onDone={clearSelection}
          onDelete={handleBulkDelete}
        />
      ) : null}

      <FilterSheet
        visible={showFilters}
        onClose={() => setShowFilters(false)}
        filters={filters}
        onApply={(next) => {
          setFilters(next);
          setPage(1);
          setShowFilters(false);
        }}
        onClear={() => {
          setFilters({});
          setPage(1);
        }}
      />
    </Screen>
  );
}

/* ------------------------------- Row -------------------------------------- */

function TransactionRow({
  row,
  showIcon,
  selectionMode,
  selected,
  onPress,
  onLongPress,
  onDelete,
  onEdit,
  onReviewed,
}: {
  row: TransactionListItem;
  showIcon: boolean;
  selectionMode: boolean;
  selected: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onReviewed: () => void;
}) {
  const theme = useTheme();
  const icon = (row.categoryIcon as IconName) ?? (row.isTransfer ? 'swap-horizontal-outline' : 'pricetag-outline');
  const color = row.isTransfer ? theme.colors.accent.base : (row.categoryColor ?? theme.colors.muted);
  const subtitleParts = row.isTransfer
    ? [`${row.accountName} → ${row.transferAccountName ?? '?'}`]
    : [row.categoryName ?? 'Uncategorised', row.accountName];
  if (row.isRecurring) subtitleParts.push('Recurring');
  if (row.splitCount > 0) subtitleParts.push(`${row.splitCount} splits`);
  if (!row.isReviewed) subtitleParts.push('Needs review');

  return (
    <SwipeableRow
      enabled={!selectionMode}
      onLongPress={onLongPress}
      leftAction={{
        icon: 'create-outline',
        label: 'Edit',
        color: theme.colors.accent.base,
        background: `${theme.colors.accent.base}22`,
        onTrigger: onEdit,
      }}
      rightAction={{ icon: 'trash-outline', label: 'Delete', onTrigger: onDelete }}>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          paddingVertical: theme.spacing.md,
          paddingHorizontal: theme.spacing.xs,
          backgroundColor: selected ? `${theme.colors.accent.base}14` : pressed ? theme.colors.pressed : 'transparent',
        })}>
        {selectionMode ? (
          <Ionicons
            name={selected ? 'checkmark-circle' : 'ellipse-outline'}
            size={22}
            color={selected ? theme.colors.accent.base : theme.colors.muted}
          />
        ) : null}
        {showIcon ? (
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: theme.radius.md,
              backgroundColor: `${color}22`,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <Ionicons name={icon} size={18} color={color} />
          </View>
        ) : null}
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="bodyMedium" numberOfLines={1}>
            {row.merchant || row.description || row.categoryName || 'Transaction'}
          </AppText>
          <AppText variant="caption" tone="muted" numberOfLines={1}>
            {subtitleParts.filter(Boolean).join(' · ')}
          </AppText>
        </View>
        <MoneyText amount={row.amount} variant="numericBody" tone={row.isTransfer ? 'neutral' : 'auto'} />
      </Pressable>
    </SwipeableRow>
  );
}

/* --------------------------- Bulk action bar ------------------------------ */

function BulkActionBar({ ids, onDone, onDelete }: { ids: string[]; onDone: () => void; onDelete: () => void }) {
  const theme = useTheme();
  const [sheet, setSheet] = useState<'none' | 'category' | 'account' | 'tag'>('none');
  const categories = useQuery(() => listCategories(), []);
  const accounts = useQuery(() => listAccounts(), []);
  const tags = useQuery(() => listTags(), []);

  const categoryItems = useMemo(() => {
    const tree = buildCategoryTree(categories.data ?? []);
    return tree.flatMap((parent) => [
      { id: parent.id, label: parent.name, icon: parent.icon as IconName, color: parent.color, section: 'Categories' },
      ...parent.children.map((child) => ({
        id: child.id,
        label: child.name,
        icon: child.icon as IconName,
        color: child.color,
        section: parent.name,
      })),
    ]);
  }, [categories.data]);

  return (
    <View
      style={{
        position: 'absolute',
        left: theme.spacing.lg,
        right: theme.spacing.lg,
        bottom: theme.spacing.xl,
        backgroundColor: theme.colors.surfaceElevated,
        borderColor: theme.colors.border,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: theme.radius.lg,
        padding: theme.spacing.md,
        ...theme.shadow('lg'),
      }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing.sm }}>
        <BulkButton icon="pricetag-outline" label="Category" onPress={() => setSheet('category')} />
        <BulkButton icon="wallet-outline" label="Account" onPress={() => setSheet('account')} />
        <BulkButton icon="pricetags-outline" label="Tag" onPress={() => setSheet('tag')} />
        <BulkButton
          icon="checkmark-done-outline"
          label="Reviewed"
          onPress={async () => {
            await markReviewed(ids, true);
            toast.show('Marked reviewed');
            onDone();
          }}
        />
        <BulkButton icon="trash-outline" label="Delete" tone="negative" onPress={onDelete} />
      </View>

      <PickerSheet
        visible={sheet === 'category'}
        onClose={() => setSheet('none')}
        title={`Categorise ${ids.length} transactions`}
        items={categoryItems}
        onSelect={async (item) => {
          await bulkUpdateCategory(ids, item.id);
          setSheet('none');
          toast.show(`Moved to ${item.label}`);
          onDone();
        }}
      />
      <PickerSheet
        visible={sheet === 'account'}
        onClose={() => setSheet('none')}
        title={`Move ${ids.length} transactions`}
        items={(accounts.data ?? []).map((account) => ({
          id: account.id,
          label: account.name,
          subtitle: ACCOUNT_TYPE_LABELS[account.type],
          icon: 'wallet-outline' as IconName,
          color: account.color ?? undefined,
        }))}
        onSelect={async (item) => {
          await bulkUpdateAccount(ids, item.id);
          setSheet('none');
          toast.show(`Moved to ${item.label}`);
          onDone();
        }}
      />
      <PickerSheet
        visible={sheet === 'tag'}
        onClose={() => setSheet('none')}
        title={`Tag ${ids.length} transactions`}
        items={(tags.data ?? []).map((tag) => ({ id: tag.id, label: tag.name, icon: 'pricetag-outline' as IconName, color: tag.color }))}
        emptyTitle="No tags yet"
        emptyMessage="Create a tag from More → Tags first."
        onSelect={async (item) => {
          await addTagToTransactions(ids, item.id);
          setSheet('none');
          toast.show(`Tagged ${item.label}`);
          onDone();
        }}
      />
    </View>
  );
}

function BulkButton({
  icon,
  label,
  onPress,
  tone,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  tone?: 'negative';
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        alignItems: 'center',
        gap: 4,
        paddingVertical: theme.spacing.sm,
        opacity: pressed ? 0.6 : 1,
      })}>
      <Ionicons name={icon} size={19} color={tone === 'negative' ? theme.colors.negative : theme.colors.text} />
      <AppText variant="caption" tone={tone === 'negative' ? 'negative' : 'secondary'} style={{ fontSize: 10 }}>
        {label}
      </AppText>
    </Pressable>
  );
}

/* ------------------------------ Filter sheet ------------------------------ */

function countActiveFilters(filters: TransactionFilters): number {
  let count = 0;
  if (filters.from || filters.to) count++;
  if (filters.accountIds?.length) count++;
  if (filters.categoryIds?.length) count++;
  if (filters.tagIds?.length) count++;
  if (filters.minAmount !== undefined || filters.maxAmount !== undefined) count++;
  if (filters.merchant) count++;
  if (filters.onlyRecurring) count++;
  if (filters.includeTransfers === false) count++;
  if (filters.includeRefunds === false) count++;
  if (filters.includeAdjustments === false) count++;
  return count;
}

function FilterSheet({
  visible,
  onClose,
  filters,
  onApply,
  onClear,
}: {
  visible: boolean;
  onClose: () => void;
  filters: TransactionFilters;
  onApply: (filters: TransactionFilters) => void;
  onClear: () => void;
}) {
  const theme = useTheme();
  const [draft, setDraft] = useState<TransactionFilters>(filters);
  const [sheet, setSheet] = useState<'none' | 'accounts' | 'categories' | 'tags' | 'from' | 'to'>('none');

  React.useEffect(() => {
    if (visible) setDraft(filters);
  }, [visible, filters]);

  const accounts = useQuery(() => listAccounts(), []);
  const categories = useQuery(() => listCategories(), []);
  const tags = useQuery(() => listTags(), []);

  const accountName = (id: string) => accounts.data?.find((account) => account.id === id)?.name ?? id;
  const categoryName = (id: string) => categories.data?.find((category) => category.id === id)?.name ?? id;
  const tagName = (id: string) => tags.data?.find((tag) => tag.id === id)?.name ?? id;

  const amountPresets: [string, number | undefined, number | undefined][] = [
    ['Under ₹500', undefined, 50_000],
    ['₹500 – ₹2,000', 50_000, 200_000],
    ['₹2,000 – ₹10,000', 200_000, 1_000_000],
    ['Over ₹10,000', 1_000_000, undefined],
  ];

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Filters"
      maxHeightRatio={0.9}
      footer={
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
          <Button label="Clear all" variant="secondary" onPress={onClear} style={{ flex: 1 }} />
          <Button label="Apply" onPress={() => onApply(draft)} style={{ flex: 2 }} />
        </View>
      }>
      <View style={{ gap: theme.spacing.lg }}>
        {/* Date */}
        <FilterBlock label="Date">
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
            <Chip label={draft.from ? `From ${draft.from}` : 'From'} selected={Boolean(draft.from)} onPress={() => setSheet('from')} />
            <Chip label={draft.to ? `To ${draft.to}` : 'To'} selected={Boolean(draft.to)} onPress={() => setSheet('to')} />
            <Chip
              label="This month"
              onPress={() => {
                const now = new Date();
                setDraft({ ...draft, from: toISODate(new Date(now.getFullYear(), now.getMonth(), 1)), to: toISODate(now) });
              }}
            />
            <Chip
              label="Last 30 days"
              onPress={() => {
                const now = new Date();
                setDraft({ ...draft, from: toISODate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29)), to: toISODate(now) });
              }}
            />
          </View>
        </FilterBlock>

        {/* Accounts */}
        <FilterBlock
          label="Accounts"
          actionLabel={draft.accountIds?.length ? 'Clear' : undefined}
          onAction={() => setDraft({ ...draft, accountIds: undefined })}>
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
            {(draft.accountIds ?? []).map((id) => (
              <Chip key={id} label={accountName(id)} selected onPress={() => setDraft({ ...draft, accountIds: draft.accountIds?.filter((x) => x !== id) })} />
            ))}
            <Chip label="Choose accounts" icon="add" onPress={() => setSheet('accounts')} />
          </View>
        </FilterBlock>

        {/* Categories */}
        <FilterBlock
          label="Categories"
          actionLabel={draft.categoryIds?.length ? 'Clear' : undefined}
          onAction={() => setDraft({ ...draft, categoryIds: undefined })}>
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
            {(draft.categoryIds ?? []).map((id) => (
              <Chip key={id} label={categoryName(id)} selected onPress={() => setDraft({ ...draft, categoryIds: draft.categoryIds?.filter((x) => x !== id) })} />
            ))}
            <Chip label="Choose categories" icon="add" onPress={() => setSheet('categories')} />
          </View>
        </FilterBlock>

        {/* Amount */}
        <FilterBlock label="Amount">
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
            {amountPresets.map(([label, min, max]) => (
              <Chip
                key={label}
                label={label}
                selected={draft.minAmount === min && draft.maxAmount === max}
                onPress={() => setDraft({ ...draft, minAmount: min, maxAmount: max })}
              />
            ))}
            {(draft.minAmount !== undefined || draft.maxAmount !== undefined) ? (
              <Chip label="Clear" onPress={() => setDraft({ ...draft, minAmount: undefined, maxAmount: undefined })} />
            ) : null}
          </View>
        </FilterBlock>

        {/* Tags */}
        <FilterBlock
          label="Tags"
          actionLabel={draft.tagIds?.length ? 'Clear' : undefined}
          onAction={() => setDraft({ ...draft, tagIds: undefined })}>
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
            {(draft.tagIds ?? []).map((id) => (
              <Chip key={id} label={tagName(id)} selected onPress={() => setDraft({ ...draft, tagIds: draft.tagIds?.filter((x) => x !== id) })} />
            ))}
            <Chip label="Choose tags" icon="add" onPress={() => setSheet('tags')} />
          </View>
        </FilterBlock>

        {/* Toggles */}
        <FilterBlock label="Include">
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
            <Chip label="Transfers" selected={draft.includeTransfers === true} onPress={() => setDraft({ ...draft, includeTransfers: draft.includeTransfers === true ? false : true })} />
            <Chip label="Refunds" selected={draft.includeRefunds === true} onPress={() => setDraft({ ...draft, includeRefunds: draft.includeRefunds === true ? false : true })} />
            <Chip label="Adjustments" selected={draft.includeAdjustments === true} onPress={() => setDraft({ ...draft, includeAdjustments: draft.includeAdjustments === true ? false : true })} />
            <Chip label="Recurring only" selected={draft.onlyRecurring === true} onPress={() => setDraft({ ...draft, onlyRecurring: draft.onlyRecurring === true ? undefined : true })} />
          </View>
        </FilterBlock>

        <FilterBlock label="Merchant">
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.sm,
              backgroundColor: theme.colors.inputBackground,
              borderRadius: theme.radius.md,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.colors.border,
              paddingHorizontal: theme.spacing.md,
              height: 42,
            }}>
            <Ionicons name="storefront-outline" size={16} color={theme.colors.muted} />
            <TextInput
              value={draft.merchant ?? ''}
              onChangeText={(value) => setDraft({ ...draft, merchant: value || undefined })}
              placeholder="Merchant contains…"
              placeholderTextColor={theme.colors.muted}
              style={{ flex: 1, color: theme.colors.text, fontFamily: theme.typography.body.fontFamily, fontSize: 15, paddingVertical: 0 }}
            />
          </View>
        </FilterBlock>
      </View>

      <PickerSheet
        visible={sheet === 'accounts'}
        onClose={() => setSheet('none')}
        title="Filter by account"
        items={(accounts.data ?? []).map((account) => ({
          id: account.id,
          label: account.name,
          subtitle: ACCOUNT_TYPE_LABELS[account.type],
          icon: 'wallet-outline' as IconName,
        }))}
        selectedId={null}
        onSelect={(item) => {
          setDraft((current) => ({
            ...current,
            accountIds: Array.from(new Set([...(current.accountIds ?? []), item.id])),
          }));
        }}
      />
      <PickerSheet
        visible={sheet === 'categories'}
        onClose={() => setSheet('none')}
        title="Filter by category"
        items={buildCategoryTree(categories.data ?? []).flatMap((parent) => [
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
          setDraft((current) => ({
            ...current,
            categoryIds: Array.from(new Set([...(current.categoryIds ?? []), item.id])),
          }));
        }}
      />
      <PickerSheet
        visible={sheet === 'tags'}
        onClose={() => setSheet('none')}
        title="Filter by tag"
        items={(tags.data ?? []).map((tag) => ({ id: tag.id, label: tag.name, icon: 'pricetag-outline' as IconName, color: tag.color }))}
        emptyTitle="No tags yet"
        onSelect={(item) => {
          setDraft((current) => ({ ...current, tagIds: Array.from(new Set([...(current.tagIds ?? []), item.id])) }));
        }}
      />
      <DatePickerSheet
        visible={sheet === 'from'}
        onClose={() => setSheet('none')}
        value={draft.from ? fromISODate(draft.from) ?? new Date() : new Date()}
        onSelect={(date) => setDraft((current) => ({ ...current, from: toISODate(date) }))}
        title="From date"
      />
      <DatePickerSheet
        visible={sheet === 'to'}
        onClose={() => setSheet('none')}
        value={draft.to ? fromISODate(draft.to) ?? new Date() : new Date()}
        onSelect={(date) => setDraft((current) => ({ ...current, to: toISODate(date) }))}
        title="To date"
      />
    </BottomSheet>
  );
}

function FilterBlock({
  label,
  children,
  actionLabel,
  onAction,
}: {
  label: string;
  children: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <AppText variant="captionMedium" tone="secondary">
          {label}
        </AppText>
        {actionLabel && onAction ? (
          <Pressable onPress={onAction} hitSlop={8}>
            <AppText variant="caption" tone="accent">
              {actionLabel}
            </AppText>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}
