import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/theme/theme';
import { ListGroup, ListRow, Row, ScrollScreen, ScreenHeader } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { Button, IconButton, SettingSwitch } from '@/components/ui/controls';
import { Field, FormSheet } from '@/components/ui/sheets';
import { EmptyState, LoadingBlock } from '@/components/ui/feedback';
import { confirm } from '@/components/ui/confirm';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { toast } from '@/stores/ui.store';
import {
  createAccountGroup,
  deleteAccountGroup,
  getAccountGroupsSummary,
  moveAccountToGroup,
  updateAccountGroup,
} from '@/services/accounts.service';
import { PickerSheet } from '@/components/ui/sheets';
import type { AccountGroup } from '@/db/schema';
import { ACCOUNT_TYPE_LABELS } from '@/services/accounts.service';

/** Account groups: create, rename, reorder, hide, collapse and assign accounts. */
export default function AccountGroupsScreen() {
  const theme = useTheme();
  const money = useMoney();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<AccountGroup | null>(null);
  const [name, setName] = useState('');
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignAccountId, setAssignAccountId] = useState<string | null>(null);

  const query = useQuery(() => getAccountGroupsSummary(), []);
  const data = query.data;

  const groups = data?.groups.map((entry) => entry.group!).filter(Boolean) ?? [];
  const ungrouped = data?.ungrouped?.accounts ?? [];

  const save = async () => {
    try {
      if (!name.trim()) throw new Error('Give the group a name.');
      if (editing) {
        await updateAccountGroup(editing.id, { name: name.trim() });
        toast.success('Group renamed');
      } else {
        await createAccountGroup({ name: name.trim() });
        toast.success('Group created');
      }
      setEditorOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save group');
    }
  };

  const remove = async (group: AccountGroup) => {
    const ok = await confirm({
      title: `Delete "${group.name}"?`,
      message: 'Accounts inside stay — they just become ungrouped.',
      confirmLabel: 'Delete group',
      tone: 'danger',
    });
    if (!ok) return;
    await deleteAccountGroup(group.id);
    toast.show('Group deleted');
  };

  const move = async (groupId: string, direction: -1 | 1) => {
    const index = groups.findIndex((group) => group.id === groupId);
    const target = groups[index + direction];
    if (!target) return;
    const current = groups[index]!;
    await updateAccountGroup(current.id, { sortOrder: target.sortOrder });
    await updateAccountGroup(target.id, { sortOrder: current.sortOrder });
  };

  return (
    <ScrollScreen>
      <ScreenHeader
        title="Account groups"
        subtitle="Banking, cash, cards, investments, liabilities…"
        right={<IconButton icon="add" onPress={() => { setEditing(null); setName(''); setEditorOpen(true); }} accessibilityLabel="Add group" />}
      />

      {query.loading && !data ? (
        <LoadingBlock label="Loading groups…" />
      ) : (
        <View style={{ gap: theme.spacing.lg }}>
          {groups.length === 0 ? (
            <EmptyState
              icon="folder-outline"
              title="No groups yet"
              message="Groups keep your accounts tidy — for example Banking, Cards and Investments."
              actionLabel="Create a group"
              onAction={() => {
                setEditing(null);
                setName('');
                setEditorOpen(true);
              }}
            />
          ) : (
            <ListGroup title="Groups">
              {groups.map((group, index) => {
                const summary = data?.groups.find((entry) => entry.group?.id === group.id);
                return (
                  <View key={group.id}>
                    <ListRow
                      title={group.name}
                      subtitle={`${summary?.accounts.length ?? 0} account${summary?.accounts.length === 1 ? '' : 's'}${group.isHidden ? ' · hidden' : ''}`}
                      icon={group.icon as never}
                      iconColor={group.color}
                      value={<MoneyText amount={summary?.total ?? 0} variant="numericCaption" tone="neutral" />}
                      onPress={() => {
                        setEditing(group);
                        setName(group.name);
                        setEditorOpen(true);
                      }}
                      right={
                        <Row gap="xs">
                          <IconButton
                            icon="chevron-up"
                            size={26}
                            disabled={index === 0}
                            onPress={() => move(group.id, -1)}
                            accessibilityLabel="Move group up"
                          />
                          <IconButton
                            icon="chevron-down"
                            size={26}
                            disabled={index === groups.length - 1}
                            onPress={() => move(group.id, 1)}
                            accessibilityLabel="Move group down"
                          />
                        </Row>
                      }
                    />
                    {summary && summary.accounts.length > 0 ? (
                      <View style={{ paddingLeft: theme.spacing.lg, paddingBottom: theme.spacing.sm }}>
                        {summary.accounts.map((account) => (
                          <Row key={account.id} gap="sm" style={{ paddingVertical: 6 }}>
                            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: account.color ?? theme.colors.accent.base }} />
                            <AppText variant="caption" tone="secondary" style={{ flex: 1 }} numberOfLines={1}>
                              {account.name}
                            </AppText>
                            <MoneyText amount={account.currentBalance} variant="numericCaption" tone="muted" />
                          </Row>
                        ))}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </ListGroup>
          )}

          {ungrouped.length > 0 ? (
            <ListGroup title="Ungrouped" footer={<AppText variant="caption" tone="muted" style={{ marginTop: theme.spacing.sm, marginLeft: theme.spacing.xs }}>Tap an account to move it into a group.</AppText>}>
              {ungrouped.map((account, index) => (
                <ListRow
                  key={account.id}
                  title={account.name}
                  subtitle={ACCOUNT_TYPE_LABELS[account.type]}
                  icon="wallet-outline"
                  iconColor={account.color ?? undefined}
                  value={<MoneyText amount={account.currentBalance} variant="numericCaption" tone="neutral" />}
                  onPress={() => {
                    setAssignAccountId(account.id);
                    setAssignOpen(true);
                  }}
                />
              ))}
            </ListGroup>
          ) : null}

          <ListGroup title="Visibility">
            <View style={{ padding: theme.spacing.lg, gap: theme.spacing.sm }}>
              <AppText variant="caption" tone="muted">
                Hidden groups stay in your data but collapse out of the accounts screen. Per-account visibility (net worth, totals, cash
                flow) is configured inside each account's editor.
              </AppText>
            </View>
          </ListGroup>
        </View>
      )}

      <FormSheet
        visible={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editing ? 'Edit group' : 'New group'}
        submitLabel={editing ? 'Save' : 'Create'}
        onSubmit={save}
        destructive={Boolean(editing)}
        onDelete={editing ? () => { setEditorOpen(false); void remove(editing); } : undefined}>
        <Field label="Group name" value={name} onChangeText={setName} placeholder="e.g. Banking" autoFocus />
        {editing ? (
          <View style={{ borderRadius: theme.radius.md, backgroundColor: theme.colors.inputBackground, overflow: 'hidden' }}>
            <SettingSwitch
              title="Hidden"
              subtitle="Collapse this group out of the accounts screen"
              value={editing.isHidden}
              onValueChange={async (value) => {
                await updateAccountGroup(editing.id, { isHidden: value });
                setEditing({ ...editing, isHidden: value });
              }}
            />
          </View>
        ) : null}
      </FormSheet>

      <PickerSheet
        visible={assignOpen}
        onClose={() => setAssignOpen(false)}
        title="Move account into group"
        items={[
          { id: '__none__', label: 'No group', icon: 'remove-circle-outline' as const },
          ...groups.map((group) => ({ id: group.id, label: group.name, icon: 'folder-outline' as const, color: group.color })),
        ]}
        onSelect={async (item) => {
          if (!assignAccountId) return;
          await moveAccountToGroup(assignAccountId, item.id === '__none__' ? null : item.id);
          setAssignOpen(false);
          toast.success('Account moved');
        }}
      />
    </ScrollScreen>
  );
}

export const GroupStyles = StyleSheet.create({ hidden: { display: 'none' } });
