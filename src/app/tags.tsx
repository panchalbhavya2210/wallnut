import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/theme/theme';
import { Card, Row, ScrollScreen, ScreenHeader } from '@/components/ui/layout';
import { AppText } from '@/components/ui/text';
import { Button, Chip, IconButton } from '@/components/ui/controls';
import { EmptyState, InfoBanner, LoadingBlock } from '@/components/ui/feedback';
import { Field, FormSheet } from '@/components/ui/sheets';
import { confirm } from '@/components/ui/confirm';
import { useQuery } from '@/hooks/useQuery';
import { toast } from '@/stores/ui.store';
import { createTag, deleteTag, listTags, tagUsageCounts } from '@/services/tags.service';

const COLORS = ['#6FB4FF', '#B79CFF', '#FF9F0A', '#42D392', '#FF647C', '#F5B84B', '#5EDBA6', '#FF8FA8'];

/** Tags — cross-cutting labels that sit beside categories. */
export default function TagsScreen() {
  const theme = useTheme();
  const [editorOpen, setEditorOpen] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[0]!);

  const query = useQuery(async () => {
    const [tags, counts] = await Promise.all([listTags(), tagUsageCounts()]);
    return { tags, counts };
  }, []);

  const save = async () => {
    try {
      if (!name.trim()) throw new Error('Give the tag a name.');
      await createTag(name, color);
      setEditorOpen(false);
      setName('');
      toast.success('Tag created');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create the tag');
    }
  };

  const tags = query.data?.tags ?? [];

  return (
    <ScrollScreen>
      <ScreenHeader
        title="Tags"
        subtitle="Trips, work, family, tax - anything that cuts across categories"
        hint={{ id: 'tags', message: 'Tags cut across categories — Trip, Work, Family, Tax. Tag transactions in the composer and filter by them anywhere.' }}
        right={<IconButton icon="add" onPress={() => setEditorOpen(true)} accessibilityLabel="Add tag" />}
      />

      {query.loading && !query.data ? (
        <LoadingBlock label="Loading tags…" />
      ) : tags.length === 0 ? (
        <EmptyState
          icon="pricetags-outline"
          title="No tags yet"
          message="Tags travel with a transaction in addition to its category — perfect for a trip that spans flights, food and hotels."
          actionLabel="Create a tag"
          onAction={() => setEditorOpen(true)}
        />
      ) : (
        <View style={{ gap: theme.spacing.lg }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            {tags.map((tag) => (
              <Pressable
                key={tag.id}
                onLongPress={async () => {
                  const ok = await confirm({ title: `Delete "${tag.name}"?`, message: 'The tag is removed from all transactions.', tone: 'danger', confirmLabel: 'Delete' });
                  if (!ok) return;
                  await deleteTag(tag.id);
                  toast.show('Tag deleted');
                }}>
                <Chip label={`${tag.name} · ${query.data?.counts[tag.id] ?? 0}`} selected color={tag.color} />
              </Pressable>
            ))}
          </View>

          <Card>
            <AppText variant="label" tone="muted">
              HOW TAGS DIFFER FROM CATEGORIES
            </AppText>
            <View style={{ marginTop: theme.spacing.md, gap: theme.spacing.sm }}>
              <Row gap="sm">
                <Ionicons name="pricetag-outline" size={15} color={theme.colors.muted} />
                <AppText variant="bodySmall" tone="secondary" style={{ flex: 1 }}>
                  A category answers “what was this?” — one per transaction (or per split).
                </AppText>
              </Row>
              <Row gap="sm">
                <Ionicons name="pricetags-outline" size={15} color={theme.colors.muted} />
                <AppText variant="bodySmall" tone="secondary" style={{ flex: 1 }}>
                  Tags answer “what was it part of?” — many per transaction, reused across categories.
                </AppText>
              </Row>
            </View>
          </Card>

          <InfoBanner message="Long-press a tag to delete it. Filter any list by tags from the Transactions filter sheet." />
        </View>
      )}

      <FormSheet visible={editorOpen} onClose={() => setEditorOpen(false)} title="New tag" submitLabel="Create tag" onSubmit={save}>
        <Field label="Tag name" value={name} onChangeText={setName} placeholder="e.g. Goa trip" autoFocus />
        <View style={{ gap: theme.spacing.sm }}>
          <AppText variant="captionMedium" tone="secondary">
            Colour
          </AppText>
          <Row gap="sm" wrap>
            {COLORS.map((choice) => (
              <Pressable
                key={choice}
                onPress={() => setColor(choice)}
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
        </View>
      </FormSheet>
    </ScrollScreen>
  );
}

export const TagStyles = StyleSheet.create({ hidden: { display: 'none' } });
