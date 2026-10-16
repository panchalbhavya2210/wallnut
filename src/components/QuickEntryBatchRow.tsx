import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/theme/theme';
import { useMoney } from '@/hooks/useMoney';
import { AppText } from './ui/text';
import { Chip, IconButton } from './ui/controls';
import { commandAmountMinor } from '@/ai/commands/resolve';
import { commandSummary } from '@/ai/commands/schema';
import type { QuickEntryBatchItem } from '@/ai/commands';
import { formatDayLabel, fromISODate, toISODate } from '@/utils/date';
import type { IconName } from './ui/layout';

/**
 * One row of the bulk quick-entry verification screen. Everything the user may
 * need to fix before saving is one tap away: the title renames, the amount is
 * editable in place, and the chips open the category, date and account sheets.
 */

export type BatchEditField = 'name' | 'amount' | 'category' | 'date' | 'account' | 'toAccount';

export function BatchRow({
  item,
  issue,
  disabled,
  onEdit,
  onDelete,
}: {
  item: QuickEntryBatchItem;
  /** Why this row cannot be saved yet (from `batchRowIssue`), or null. */
  issue: string | null;
  disabled?: boolean;
  onEdit: (itemId: string, field: BatchEditField) => void;
  onDelete: (itemId: string) => void;
}) {
  const theme = useTheme();
  const money = useMoney();
  const { command, resolved } = item.analysis;
  const amountMinor = commandAmountMinor(command);
  const isTransfer = command.intent === 'CREATE_TRANSFER';
  const isIncome = command.intent === 'CREATE_INCOME' || command.transactionType === 'INCOME';

  const title = isTransfer
    ? `${resolved.account?.name ?? command.account ?? '?'} → ${resolved.toAccount?.name ?? command.toAccount ?? '?'}`
    : (command.merchant ?? commandSummary(command));

  const icon: IconName =
    (resolved.category?.icon as IconName | undefined) ??
    (isTransfer ? 'swap-horizontal-outline' : isIncome ? 'arrow-down-circle-outline' : 'arrow-up-circle-outline');
  const iconColor =
    resolved.category?.color ?? (isTransfer ? theme.colors.accent.base : isIncome ? theme.colors.positive : theme.colors.negative);
  const amountColor = isTransfer ? theme.colors.textSecondary : isIncome ? theme.colors.positive : theme.colors.negative;

  const dateISO = command.date ?? toISODate(new Date());
  const parsedDate = fromISODate(dateISO);
  const dateLabel = parsedDate ? formatDayLabel(parsedDate) : dateISO;

  return (
    <View
      style={{
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.lg,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: issue ? `${theme.colors.warning}66` : theme.colors.border,
        padding: theme.spacing.md,
        gap: theme.spacing.sm,
      }}>
      {/* Title + amount */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: `${iconColor}1F`,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Ionicons name={icon} size={18} color={iconColor} />
        </View>

        <Pressable
          disabled={disabled || isTransfer}
          onPress={() => onEdit(item.id, 'name')}
          accessibilityRole={isTransfer ? undefined : 'button'}
          accessibilityLabel={isTransfer ? undefined : `Rename ${title}`}
          hitSlop={4}
          style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <AppText variant="bodyMedium" numberOfLines={1} style={{ flexShrink: 1 }}>
            {title}
          </AppText>
          {!isTransfer ? <Ionicons name="chevron-down" size={13} color={theme.colors.muted} /> : null}
        </Pressable>

        <Pressable
          disabled={disabled}
          onPress={() => onEdit(item.id, 'amount')}
          accessibilityRole="button"
          accessibilityLabel="Edit amount"
          hitSlop={6}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <AppText variant="numericSmall" style={{ color: amountMinor !== null ? amountColor : theme.colors.muted }}>
            {amountMinor !== null ? money.format(amountMinor) : 'Set amount'}
          </AppText>
          <Ionicons name="pencil" size={11} color={theme.colors.muted} />
        </Pressable>
      </View>

      {/* Editable chips */}
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: theme.spacing.sm }}>
        {!isTransfer ? (
          <Chip
            size="sm"
            label={resolved.category?.name ?? 'Category'}
            icon={resolved.category ? undefined : 'add'}
            onPress={() => onEdit(item.id, 'category')}
            accessibilityLabel={resolved.category ? `Category: ${resolved.category.name}` : 'Choose a category'}
          />
        ) : null}
        <Chip
          size="sm"
          label={dateLabel}
          icon="calendar-outline"
          onPress={() => onEdit(item.id, 'date')}
          accessibilityLabel={`Date: ${dateLabel}`}
        />
        {isTransfer ? (
          <>
            <Chip
              size="sm"
              label={resolved.account?.name ?? 'From'}
              icon="arrow-up-outline"
              onPress={() => onEdit(item.id, 'account')}
              accessibilityLabel="Edit source account"
            />
            <Chip
              size="sm"
              label={resolved.toAccount?.name ?? 'To'}
              icon="arrow-down-outline"
              onPress={() => onEdit(item.id, 'toAccount')}
              accessibilityLabel="Edit destination account"
            />
          </>
        ) : (
          <Chip
            size="sm"
            label={resolved.account?.name ?? 'Account'}
            icon="wallet-outline"
            onPress={() => onEdit(item.id, 'account')}
            accessibilityLabel={resolved.account ? `Account: ${resolved.account.name}` : 'Choose an account'}
          />
        )}
        <View style={{ flex: 1 }} />
        <IconButton
          icon="trash-outline"
          size={32}
          color={theme.colors.muted}
          onPress={() => onDelete(item.id)}
          accessibilityLabel="Remove this row"
          disabled={disabled}
        />
      </View>

      {issue ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="alert-circle-outline" size={13} color={theme.colors.warning} />
          <AppText variant="caption" style={{ color: theme.colors.warning, flex: 1 }}>
            {issue}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}
