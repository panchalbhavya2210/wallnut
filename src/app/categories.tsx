import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/theme/theme';
import { IconName, ListGroup, ListRow, Row, ScrollScreen, ScreenHeader, SectionHeader } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { Button, Chip, IconButton } from '@/components/ui/controls';
import { EmptyState, InfoBanner, LoadingBlock } from '@/components/ui/feedback';
import { Field, FormSheet, PickerSheet } from '@/components/ui/sheets';
import { confirm } from '@/components/ui/confirm';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { toast } from '@/stores/ui.store';
import { buildCategoryTree, createCategory, deleteCategory, listCategories, updateCategory } from '@/services/categories.service';
import { getCategoryBreakdown } from '@/services/analytics.service';
import { getPeriodRange } from '@/utils/date';
import type { Category } from '@/db/schema';

const ICON_CHOICES: IconName[] = [
  'restaurant-outline', 'cart-outline', 'car-outline', 'bag-handle-outline', 'receipt-outline', 'repeat-outline',
  'home-outline', 'film-outline', 'game-controller-outline', 'medkit-outline', 'barbell-outline', 'airplane-outline',
  'school-outline', 'person-outline', 'people-outline', 'pricetag-outline', 'cash-outline', 'laptop-outline',
  'trending-up-outline', 'gift-outline', 'add-circle-outline', 'ellipsis-horizontal-outline',
];

const COLOR_CHOICES = [
  '#FF3D8B', '#FF647C', '#FF8FA8', '#F472B6', '#E879F9',
  '#FF9F0A', '#F5B84B', '#FFD60A', '#FFB547',
  '#42D392', '#22C55E', '#6EE7A8', '#5EDBA6', '#14B8A6',
  '#5E9BFF', '#6FB4FF', '#3B82F6', '#8B8CFF', '#B79CFF', '#C4A9FF', '#8B5CF6', '#929AA8',
];

/** Manage categories and subcategories, with live spend for the current month. */
export default function CategoriesScreen() {
  const theme = useTheme();
  const money = useMoney();
  const [tab, setTab] = useState<'expense' | 'income'>('expense');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [parentId, setParentId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<IconName>('pricetag-outline');
  const [color, setColor] = useState(COLOR_CHOICES[0]!);
  const [colorDraft, setColorDraft] = useState(COLOR_CHOICES[0]!);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);

  const query = useQuery(async () => {
    const [categories, breakdown] = await Promise.all([
      listCategories({ includeArchived: true }),
      getCategoryBreakdown({ range: getPeriodRange('thisMonth', {}) }, { limit: 60 }),
    ]);
    return { categories, spendById: new Map(breakdown.rows.map((row) => [row.categoryId ?? 'none', row])) };
  }, []);

  const tree = useMemo(() => buildCategoryTree(query.data?.categories.filter((category) => category.type === tab) ?? []), [query.data, tab]);

  const openEditor = (category: Category | null, parent: string | null) => {
    setEditing(category);
    setParentId(parent);
    setName(category?.name ?? '');
    setIcon((category?.icon as IconName) ?? 'pricetag-outline');
    setColor(category?.color ?? COLOR_CHOICES[0]!);
    setColorDraft(category?.color ?? COLOR_CHOICES[0]!);
    setEditorOpen(true);
  };

  const save = async () => {
    try {
      if (!name.trim()) throw new Error('Give the category a name.');
      if (editing) {
        await updateCategory(editing.id, { name: name.trim(), icon, color });
        toast.success('Category updated');
      } else {
        await createCategory({ name: name.trim(), icon, color, parentId, type: tab });
        toast.success('Category created');
      }
      setEditorOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save category');
    }
  };

  const remove = async (category: Category) => {
    const ok = await confirm({
      title: `Delete "${category.name}"?`,
      message: 'Transactions move to the parent category (or Other) — nothing is lost.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    const result = await deleteCategory(category.id);
    toast.show(`Category deleted · ${result.reassigned} transaction${result.reassigned === 1 ? '' : 's'} reassigned`);
  };

  return (
    <ScrollScreen>
      <ScreenHeader
        title="Categories"
        subtitle={`${tree.length} top-level · ${tree.reduce((sum, entry) => sum + entry.children.length, 0)} subcategories`}
        right={<IconButton icon="add" onPress={() => openEditor(null, null)} accessibilityLabel="Add category" />}
      />

      <Row gap="sm" style={{ marginBottom: theme.spacing.lg }}>
        <Chip label="Expense" selected={tab === 'expense'} onPress={() => setTab('expense')} />
        <Chip label="Income" selected={tab === 'income'} onPress={() => setTab('income')} />
      </Row>

      {query.loading && !query.data ? (
        <LoadingBlock label="Loading categories…" />
      ) : tree.length === 0 ? (
        <EmptyState icon="pricetags-outline" title="No categories" message="Create your first category to organise spending." actionLabel="Add category" onAction={() => openEditor(null, null)} />
      ) : (
        <View style={{ gap: theme.spacing.lg }}>
          {tree.map((parent) => {
            const spend = query.data?.spendById.get(parent.id);
            return (
              <View key={parent.id}>
                <ListGroup>
                  <ListRow
                    title={parent.name}
                    subtitle={spend ? `${spend.count} transactions this month` : 'No spending this month'}
                    icon={parent.icon as IconName}
                    iconColor={parent.color}
                    value={spend ? <MoneyText amount={spend.total} variant="numericCaption" tone="neutral" /> : undefined}
                    onPress={() => openEditor(parent, null)}
                  />
                  {parent.children.map((child) => {
                    const childSpend = query.data?.spendById.get(child.id);
                    return (
                      <ListRow
                        key={child.id}
                        title={child.name}
                        subtitle={childSpend ? `${childSpend.count} transactions` : 'Subcategory'}
                        icon={child.icon as IconName}
                        iconColor={child.color}
                        compact
                        value={childSpend ? <MoneyText amount={childSpend.total} variant="numericCaption" tone="muted" /> : undefined}
                        onPress={() => openEditor(child, parent.id)}
                      />
                    );
                  })}
                  <ListRow
                    title="Add subcategory"
                    icon="add-circle-outline"
                    iconColor={theme.colors.muted}
                    compact
                    onPress={() => openEditor(null, parent.id)}
                  />
                </ListGroup>
              </View>
            );
          })}
        </View>
      )}

      <View style={{ marginTop: theme.spacing.xl }}>
        <InfoBanner
          message="Subcategories roll up into their parent everywhere: dashboards, budgets and reports. Drill into a parent to see the breakdown."
        />
      </View>

      <FormSheet
        visible={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editing ? 'Edit category' : parentId ? 'New subcategory' : 'New category'}
        submitLabel={editing ? 'Save' : 'Create'}
        onSubmit={save}
        destructive={Boolean(editing)}
        onDelete={editing ? () => { setEditorOpen(false); void remove(editing); } : undefined}>
        <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Groceries" autoFocus />
        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="captionMedium" tone="secondary">
            Icon
          </AppText>
          <Pressable
            onPress={() => setIconPickerOpen(true)}
            android_ripple={{ color: theme.colors.ripple }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.md,
              padding: theme.spacing.md,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.inputBackground,
            }}>
            <View style={{ width: 36, height: 36, borderRadius: theme.radius.md, backgroundColor: `${color}22`, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name={icon} size={18} color={color} />
            </View>
            <AppText variant="bodySmall" tone="secondary" style={{ flex: 1 }}>
              Tap to change icon
            </AppText>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.muted} />
          </Pressable>
        </View>
        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="captionMedium" tone="secondary">
            Colour
          </AppText>
          <Row gap="sm" wrap>
            {COLOR_CHOICES.map((choice) => (
              <Pressable
                key={choice}
                onPress={() => {
                  setColor(choice);
                  setColorDraft(choice);
                }}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: choice,
                  borderWidth: color === choice ? 3 : 0,
                  borderColor: theme.colors.text,
                }}
              />
            ))}
          </Row>
          <Row gap="sm" align="center">
            <View style={{ flex: 1 }}>
              <Field
                label="Custom colour"
                value={colorDraft}
                onChangeText={(value) => {
                  setColorDraft(value);
                  const clean = value.trim().replace('#', '');
                  if (/^[0-9a-fA-F]{6}$/.test(clean)) setColor(`#${clean.toUpperCase()}`);
                }}
                placeholder="#FF3D8B"
              />
            </View>
            <View
              style={{
                width: 42,
                height: 42,
                borderRadius: 21,
                backgroundColor: color,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.colors.borderStrong,
              }}
            />
          </Row>
          <AppText variant="caption" tone="muted">
            Pick a swatch or paste any 6-digit hex — the colour follows the category through charts, lists and budgets.
          </AppText>
        </View>
      </FormSheet>

      <PickerSheet
        visible={iconPickerOpen}
        onClose={() => setIconPickerOpen(false)}
        title="Choose icon"
        items={ICON_CHOICES.map((choice) => ({ id: choice, label: choice.replace('-outline', '').replace(/-/g, ' '), icon: choice, color }))}
        selectedId={icon}
        onSelect={(item) => {
          setIcon(item.id as IconName);
          setIconPickerOpen(false);
        }}
      />
    </ScrollScreen>
  );
}

export const CategoryScreenStyles = StyleSheet.create({ hidden: { display: 'none' } });
