import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { Card, IconName, ListRow, Row, ScrollScreen, ScreenHeader } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { Button, Chip, IconButton } from '@/components/ui/controls';
import { EmptyState, InfoBanner, LoadingBlock } from '@/components/ui/feedback';
import { BottomSheet, Field, FormSheet, PickerSheet } from '@/components/ui/sheets';
import { confirm } from '@/components/ui/confirm';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { toast } from '@/stores/ui.store';
import { listAccounts, ACCOUNT_TYPE_LABELS } from '@/services/accounts.service';
import { buildCategoryTree, listCategories } from '@/services/categories.service';
import {
  addShoppingListItem,
  convertShoppingListToTransaction,
  createShoppingList,
  deleteShoppingList,
  getShoppingList,
  listShoppingLists,
  removeShoppingListItem,
  renameShoppingList,
  reopenShoppingList,
  shoppingListTotal,
  updateShoppingListItem,
} from '@/services/shopping.service';
import type { ShoppingListItem } from '@/db/schema';

/**
 * Shopping lists — plan items with prices, tick them off while shopping, then
 * create ONE itemised transaction from the whole list (each item becomes a
 * split, so the ledger counts the purchase once).
 */
export default function ShoppingScreen() {
  const theme = useTheme();
  const money = useMoney();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newListOpen, setNewListOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [convertOpen, setConvertOpen] = useState(false);
  const [itemName, setItemName] = useState('');
  const [itemPrice, setItemPrice] = useState('');
  const [itemQuantity, setItemQuantity] = useState('1');
  const [busy, setBusy] = useState(false);

  const listsQuery = useQuery(() => listShoppingLists(true), []);
  const detailQuery = useQuery(() => (selectedId ? getShoppingList(selectedId) : Promise.resolve(null)), [selectedId]);
  const accountsQuery = useQuery(() => listAccounts(), [convertOpen]);
  const categoriesQuery = useQuery(() => listCategories(), [convertOpen]);

  const activeLists = (listsQuery.data ?? []).filter((list) => list.status === 'active');
  const completedLists = (listsQuery.data ?? []).filter((list) => list.status === 'completed');
  const detail = detailQuery.data;
  const items = detail?.items ?? [];
  const total = useMemo(() => shoppingListTotal(items), [items]);
  const checkedCount = items.filter((item) => item.isChecked).length;

  const refresh = () => {
    listsQuery.refresh();
    detailQuery.refresh();
  };

  const parsedPrice = (value: string) => Math.round(Number(value.replace(/[^0-9.]/g, '') || '0') * 100);
  const parsedQuantity = (value: string) => Math.max(1, Math.round(Number(value.replace(/[^0-9]/g, '') || '1')));

  const createList = async () => {
    try {
      const list = await createShoppingList(nameDraft);
      setNewListOpen(false);
      setNameDraft('');
      setSelectedId(list.id);
      refresh();
      toast.success('List created');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create the list');
    }
  };

  const addItem = async () => {
    if (!detail) return;
    if (!itemName.trim()) {
      toast.error('Enter the item name.');
      return;
    }
    try {
      await addShoppingListItem(detail.list.id, {
        name: itemName,
        price: parsedPrice(itemPrice),
        quantity: parsedQuantity(itemQuantity),
      });
      setItemName('');
      setItemPrice('');
      setItemQuantity('1');
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not add the item');
    }
  };

  return (
    <>
      <ScrollScreen>
        <ScreenHeader
          title="Shopping lists"
          subtitle={activeLists.length > 0 ? `${activeLists.length} active list${activeLists.length === 1 ? '' : 's'}` : 'Plan, shop, then record once'}
          hint={{ id: 'shopping', message: 'Add items with prices as you plan. When you finish shopping, "Create transaction" writes the whole list as one expense with a split per item.' }}
          right={<IconButton icon="add" accessibilityLabel="New list" onPress={() => { setNameDraft(''); setNewListOpen(true); }} />}
        />

        {listsQuery.loading && !listsQuery.data ? (
          <LoadingBlock label="Loading lists…" />
        ) : activeLists.length === 0 && completedLists.length === 0 ? (
          <EmptyState
            icon="basket-outline"
            title="No shopping lists yet"
            message="Create a list, add items with prices, then turn the whole list into one itemised transaction."
            actionLabel="New list"
            onAction={() => { setNameDraft(''); setNewListOpen(true); }}
          />
        ) : (
          <View style={{ gap: theme.spacing.lg }}>
            <Row gap="sm" wrap>
              {activeLists.map((list) => (
                <Chip key={list.id} label={list.name} selected={selectedId === list.id} onPress={() => setSelectedId(list.id)} />
              ))}
              {activeLists.length === 0 ? (
                <AppText variant="caption" tone="muted">
                  No active lists — create one with the + button.
                </AppText>
              ) : null}
            </Row>

            {detail && detail.list.status === 'active' ? (
              <View style={{ gap: theme.spacing.lg }}>
                {/* Create record — at the top, one transaction for the whole list */}
                <Card style={{ borderColor: total > 0 ? theme.colors.accent.base : theme.colors.border }}>
                  <Row justify="space-between">
                    <View style={{ flex: 1 }}>
                      <AppText variant="bodyMedium">{detail.list.name}</AppText>
                      <AppText variant="caption" tone="muted">
                        {items.length} item{items.length === 1 ? '' : 's'}
                        {checkedCount > 0 ? ` · ${checkedCount} ticked` : ''} · total {money.format(total)}
                      </AppText>
                    </View>
                    <Row gap="sm">
                      <IconButton
                        icon="create-outline"
                        accessibilityLabel="Rename list"
                        size={36}
                        background={theme.colors.inputBackground}
                        onPress={() => {
                          setNameDraft(detail.list.name);
                          setRenameOpen(true);
                        }}
                      />
                      <IconButton
                        icon="trash-outline"
                        accessibilityLabel="Delete list"
                        size={36}
                        background={theme.colors.negativeSoft}
                        color={theme.colors.negative}
                        onPress={async () => {
                          const ok = await confirm({
                            title: 'Delete this list?',
                            message: 'The plan is removed. Any transaction already created from it stays in your ledger.',
                            confirmLabel: 'Delete',
                            tone: 'danger',
                          });
                          if (!ok) return;
                          await deleteShoppingList(detail.list.id);
                          setSelectedId(null);
                          refresh();
                        }}
                      />
                    </Row>
                  </Row>

                  <Button
                    label={`Create transaction · ${money.format(total)}`}
                    icon="checkmark-circle-outline"
                    fullWidth
                    style={{ marginTop: theme.spacing.md }}
                    disabled={items.length === 0 || total <= 0}
                    onPress={() => setConvertOpen(true)}
                  />
                  <AppText variant="caption" tone="muted" style={{ marginTop: theme.spacing.sm }}>
                    One expense with a split for every item — grouping without double counting.
                  </AppText>
                </Card>

                {/* Add item */}
                <Card>
                  <AppText variant="label" tone="muted">
                    ADD ITEM
                  </AppText>
                  <View style={{ gap: theme.spacing.md, marginTop: theme.spacing.sm }}>
                    <Field label="Item" value={itemName} onChangeText={setItemName} placeholder="e.g. Milk 1L" />
                    <Row gap="sm" align="flex-end">
                      <View style={{ flex: 1 }}>
                        <Field
                          label="Price"
                          value={itemPrice}
                          onChangeText={setItemPrice}
                          keyboardType="decimal-pad"
                          placeholder="0"
                          prefix={money.currency === 'INR' ? '₹' : money.currency}
                          money
                        />
                      </View>
                      <View style={{ width: 84 }}>
                        <Field label="Qty" value={itemQuantity} onChangeText={setItemQuantity} keyboardType="numeric" placeholder="1" />
                      </View>
                    </Row>
                    <Button label="Add item" variant="secondary" icon="add" onPress={addItem} />
                  </View>
                </Card>

                {/* Items */}
                <Card padded={false}>
                  {items.length === 0 ? (
                    <View style={{ padding: theme.spacing.lg }}>
                      <AppText variant="bodySmall" tone="muted">
                        No items yet — add the first one above.
                      </AppText>
                    </View>
                  ) : (
                    items.map((item, index) => (
                      <ItemRow
                        key={item.id}
                        item={item}
                        first={index === 0}
                        money={money}
                        onToggle={() => {
                          void updateShoppingListItem(item.id, { isChecked: !item.isChecked }).then(refresh);
                        }}
                        onRemove={() => {
                          void removeShoppingListItem(item.id).then(refresh);
                        }}
                      />
                    ))
                  )}
                </Card>
              </View>
            ) : null}

            {completedLists.length > 0 ? (
              <View style={{ gap: theme.spacing.sm }}>
                <AppText variant="label" tone="muted">
                  COMPLETED
                </AppText>
                {completedLists.map((list) => (
                  <Card key={list.id}>
                    <Row justify="space-between">
                      <View style={{ flex: 1 }}>
                        <AppText variant="bodyMedium">{list.name}</AppText>
                        <AppText variant="caption" tone="muted">
                          {list.completedAt ? `Recorded ${new Date(list.completedAt).toLocaleDateString()}` : 'Completed'}
                        </AppText>
                      </View>
                      <Row gap="sm">
                        {list.transactionId ? (
                          <Button
                            label="View"
                            size="sm"
                            variant="ghost"
                            onPress={() => router.push(`/transaction/${list.transactionId}` as never)}
                          />
                        ) : null}
                        <Button
                          label="Reopen"
                          size="sm"
                          variant="secondary"
                          onPress={async () => {
                            await reopenShoppingList(list.id);
                            setSelectedId(list.id);
                            refresh();
                          }}
                        />
                      </Row>
                    </Row>
                  </Card>
                ))}
              </View>
            ) : null}

            <InfoBanner
              icon="basket-outline"
              message="Lists live on this device with your ledger. They never move money until you create the transaction."
            />
          </View>
        )}
      </ScrollScreen>

      <FormSheet
        visible={newListOpen}
        onClose={() => setNewListOpen(false)}
        title="New shopping list"
        submitLabel="Create list"
        submitDisabled={!nameDraft.trim()}
        onSubmit={createList}>
        <Field label="List name" value={nameDraft} onChangeText={setNameDraft} placeholder="e.g. Weekly groceries" autoFocus />
      </FormSheet>

      <FormSheet
        visible={renameOpen}
        onClose={() => setRenameOpen(false)}
        title="Rename list"
        submitLabel="Save"
        submitDisabled={!nameDraft.trim()}
        onSubmit={async () => {
          if (!detail) return;
          await renameShoppingList(detail.list.id, nameDraft);
          setRenameOpen(false);
          refresh();
        }}>
        <Field label="List name" value={nameDraft} onChangeText={setNameDraft} autoFocus />
      </FormSheet>

      {detail ? (
        <ConvertSheet
          visible={convertOpen}
          onClose={() => setConvertOpen(false)}
          listName={detail.list.name}
          total={total}
          itemCount={items.length}
          accounts={(accountsQuery.data ?? []).map((account) => ({
            id: account.id,
            name: account.name,
            subtitle: ACCOUNT_TYPE_LABELS[account.type],
            color: account.color,
          }))}
          categories={buildCategoryTree(categoriesQuery.data ?? []).flatMap((parent) => [
            { id: parent.id, label: parent.name, section: undefined as string | undefined },
            ...parent.children.map((child) => ({ id: child.id, label: child.name, section: parent.name })),
          ])}
          busy={busy}
          onCreate={async (accountId, categoryId, merchant) => {
            setBusy(true);
            try {
              const result = await convertShoppingListToTransaction(detail.list.id, { accountId, categoryId, merchant });
              setConvertOpen(false);
              refresh();
              toast.success(`Transaction created · ${money.format(result.total)}`);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : 'Could not create the transaction');
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : null}
    </>
  );
}

function ItemRow({
  item,
  first,
  money,
  onToggle,
  onRemove,
}: {
  item: ShoppingListItem;
  first: boolean;
  money: ReturnType<typeof useMoney>;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.md,
        borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.border,
      }}>
      <Pressable onPress={onToggle} hitSlop={8} accessibilityRole="checkbox" accessibilityState={{ checked: item.isChecked }}>
        <Ionicons
          name={item.isChecked ? 'checkmark-circle' : 'ellipse-outline'}
          size={24}
          color={item.isChecked ? theme.colors.positive : theme.colors.borderStrong}
        />
      </Pressable>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="bodySmall" style={item.isChecked ? { textDecorationLine: 'line-through', opacity: 0.6 } : undefined}>
          {item.name}
        </AppText>
        <AppText variant="caption" tone="muted">
          {item.quantity > 1 ? `${item.quantity} × ${money.format(item.price)}` : money.format(item.price)}
        </AppText>
      </View>
      <MoneyText amount={item.price * item.quantity} variant="numericCaption" tone={item.isChecked ? 'muted' : 'neutral'} />
      <Pressable onPress={onRemove} hitSlop={8} accessibilityLabel={`Remove ${item.name}`}>
        <Ionicons name="close-circle-outline" size={20} color={theme.colors.muted} />
      </Pressable>
    </View>
  );
}

function ConvertSheet({
  visible,
  onClose,
  listName,
  total,
  itemCount,
  accounts,
  categories,
  busy,
  onCreate,
}: {
  visible: boolean;
  onClose: () => void;
  listName: string;
  total: number;
  itemCount: number;
  accounts: { id: string; name: string; subtitle: string; color: string | null }[];
  categories: { id: string; label: string; section?: string }[];
  busy: boolean;
  onCreate: (accountId: string, categoryId: string, merchant: string | null) => void;
}) {
  const theme = useTheme();
  const money = useMoney();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [merchant, setMerchant] = useState(listName);
  const [picker, setPicker] = useState<'none' | 'account' | 'category'>('none');

  const account = accounts.find((entry) => entry.id === accountId);
  const category = categories.find((entry) => entry.id === categoryId);

  return (
    <>
      <BottomSheet visible={visible} onClose={onClose} title="Create transaction">
        <View style={{ gap: theme.spacing.lg, paddingBottom: theme.spacing.md }}>
          <Card style={{ backgroundColor: theme.colors.inputBackground }}>
            <Row justify="space-between">
              <AppText variant="bodySmall" tone="secondary">
                {itemCount} item{itemCount === 1 ? '' : 's'} · one expense, split per item
              </AppText>
              <MoneyText amount={total} variant="numericBody" tone="negative" />
            </Row>
          </Card>

          <ListRow title="Paid from" value={account?.name ?? 'Choose account'} onPress={() => setPicker('account')} chevron />
          <ListRow title="Category" value={category?.label ?? 'Choose category'} onPress={() => setPicker('category')} chevron />
          <Field label="Merchant (optional)" value={merchant} onChangeText={setMerchant} placeholder={listName} />

          <Button
            label={`Create · ${money.format(total)}`}
            loading={busy}
            disabled={!accountId || !categoryId}
            onPress={() => onCreate(accountId!, categoryId!, merchant.trim() || null)}
          />
          <AppText variant="caption" tone="muted">
            It lands in your ledger as a single expense dated today; each split keeps the item name.
          </AppText>
        </View>
      </BottomSheet>

      <PickerSheet
        visible={picker === 'account'}
        onClose={() => setPicker('none')}
        title="Paid from"
        items={accounts.map((entry) => ({
          id: entry.id,
          label: entry.name,
          subtitle: entry.subtitle,
          icon: 'wallet-outline' as IconName,
          color: entry.color ?? undefined,
        }))}
        onSelect={(item) => {
          setAccountId(item.id);
          setPicker('none');
        }}
      />

      <PickerSheet
        visible={picker === 'category'}
        onClose={() => setPicker('none')}
        title="Category"
        items={categories.map((entry) => ({ id: entry.id, label: entry.label, section: entry.section, icon: 'pricetag-outline' as IconName }))}
        onSelect={(item) => {
          setCategoryId(item.id);
          setPicker('none');
        }}
      />
    </>
  );
}
