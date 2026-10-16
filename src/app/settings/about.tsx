import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Constants from 'expo-constants';

import { useTheme } from '@/theme/theme';
import { Card, ListGroup, Row, ScrollScreen } from '@/components/ui/layout';
import { AppText } from '@/components/ui/text';
import { useQuery } from '@/hooks/useQuery';
import { getSqlite } from '@/db/client';
import { attachmentsStorageBytes } from '@/services/attachments.service';
import { formatCount } from '@/utils/format';

export default function AboutSettings() {
  const theme = useTheme();

  const stats = useQuery(async () => {
    const sqlite = getSqlite();
    const row = await sqlite.getFirstAsync<{ transactions: number; accounts: number; categories: number; budgets: number }>(
      `SELECT
        (SELECT count(*) FROM transactions) AS transactions,
        (SELECT count(*) FROM accounts) AS accounts,
        (SELECT count(*) FROM categories) AS categories,
        (SELECT count(*) FROM budgets) AS budgets`,
    );
    const bytes = await attachmentsStorageBytes();
    return {
      transactions: Number(row?.transactions ?? 0),
      accounts: Number(row?.accounts ?? 0),
      categories: Number(row?.categories ?? 0),
      budgets: Number(row?.budgets ?? 0),
      attachmentBytes: bytes,
    };
  }, []);

  return (
    <ScrollScreen>
      <Row gap="sm" style={{ paddingTop: theme.spacing.md, paddingBottom: theme.spacing.lg }}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
        </Pressable>
        <AppText variant="title">About Wallnut</AppText>
      </Row>

      <View style={{ gap: theme.spacing.lg }}>
        <Card>
          <Row gap="lg">
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 18,
                backgroundColor: theme.colors.accent.base,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <AppText variant="title" style={{ color: theme.colors.accent.on }}>
                W
              </AppText>
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <AppText variant="titleSmall">Wallnut</AppText>
              <AppText variant="caption" tone="muted">
                Version {Constants.expoConfig?.version ?? '1.0.0'} · local-first personal finance
              </AppText>
            </View>
          </Row>
          <AppText variant="bodySmall" tone="secondary" style={{ marginTop: theme.spacing.lg }}>
            Wallnut turns raw transactions into financial intelligence without asking for a login, a server, or your data. Everything
            — accounts, budgets, goals, debts, analytics — is computed locally from a SQLite ledger on this device.
          </AppText>
        </Card>

        <ListGroup title="Your data">
          <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
            <Row justify="space-between">
              <AppText variant="bodySmall" tone="secondary">
                Transactions
              </AppText>
              <AppText variant="numericSmall">{formatCount(stats.data?.transactions ?? 0)}</AppText>
            </Row>
            <Row justify="space-between">
              <AppText variant="bodySmall" tone="secondary">
                Accounts
              </AppText>
              <AppText variant="numericSmall">{formatCount(stats.data?.accounts ?? 0)}</AppText>
            </Row>
            <Row justify="space-between">
              <AppText variant="bodySmall" tone="secondary">
                Categories
              </AppText>
              <AppText variant="numericSmall">{formatCount(stats.data?.categories ?? 0)}</AppText>
            </Row>
            <Row justify="space-between">
              <AppText variant="bodySmall" tone="secondary">
                Budgets
              </AppText>
              <AppText variant="numericSmall">{formatCount(stats.data?.budgets ?? 0)}</AppText>
            </Row>
            <Row justify="space-between">
              <AppText variant="bodySmall" tone="secondary">
                Receipts on disk
              </AppText>
              <AppText variant="numericSmall">
                {stats.data ? `${(stats.data.attachmentBytes / 1024 / 1024).toFixed(2)} MB` : '—'}
              </AppText>
            </Row>
          </View>
        </ListGroup>

        <ListGroup title="Built with">
          <View style={{ padding: theme.spacing.lg, gap: theme.spacing.sm }}>
            <AppText variant="bodySmall" tone="secondary">
              React Native · Expo SDK · expo-router · SQLite (expo-sqlite) · Drizzle ORM · Zustand · Reanimated · react-native-svg
            </AppText>
            <AppText variant="caption" tone="muted">
              Integer minor-unit accounting, tabular numerals, and a hand-tuned dark/light theme. No web fonts are fetched at runtime —
              Inter ships inside the app.
            </AppText>
          </View>
        </ListGroup>

        <ListGroup title="Roadmap">
          <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
            {[
              { label: 'Bank SMS import (Android)', detail: 'Bank SMS parsing feeds the same import pipeline CSV uses.' },
              { label: 'XLSX & PDF statements', detail: 'Additional import sources, same normalise → validate → dedupe path.' },
            ].map((item) => (
              <Row key={item.label} gap="md">
                <Ionicons name="construct-outline" size={15} color={theme.colors.muted} />
                <View style={{ flex: 1 }}>
                  <AppText variant="bodySmall">{item.label}</AppText>
                  <AppText variant="caption" tone="muted">
                    {item.detail}
                  </AppText>
                </View>
              </Row>
            ))}
          </View>
        </ListGroup>

        <AppText variant="caption" tone="muted" style={{ textAlign: 'center', paddingBottom: theme.spacing.xl }}>
          Made for one person: you.
        </AppText>
      </View>
    </ScrollScreen>
  );
}
