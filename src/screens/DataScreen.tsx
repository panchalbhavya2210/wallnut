import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { Card, IconName, ListGroup, ListRow, Row, ScrollScreen } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { Button, Chip, IconButton } from '@/components/ui/controls';
import { EmptyState, InfoBanner, LoadingBlock } from '@/components/ui/feedback';
import { BottomSheet, PickerSheet, FormSheet } from '@/components/ui/sheets';
import { confirm } from '@/components/ui/confirm';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { toast } from '@/stores/ui.store';
import { ACCOUNT_TYPE_LABELS, listAccounts } from '@/services/accounts.service';
import { listCategories } from '@/services/categories.service';
import {
  autoDetectMapping,
  commitImport,
  previewCsv,
  type ImportContext,
} from '@/services/import';
import { createBackup, describeBackup, exportTransactionsCsv, exportMonthlySummaryCsv, restoreBackup, validateBackup, type BackupFile } from '@/services/import/export.service';
import type { ImportMapping, ImportPreview } from '@/services/import/pipeline';
import { clearAllData, isDatabaseEmpty, seedDemoData } from '@/services/seed.service';
import { saveAndShareFile } from '@/utils/files';
import { formatCount } from '@/utils/format';

/**
 * Import, export, backup and restore. Every import runs through the shared
 * pipeline: raw → normalise → validate → duplicate-detect → commit.
 */
export default function DataScreen() {
  const theme = useTheme();
  const money = useMoney();

  const [mode, setMode] = useState<'home' | 'map' | 'preview' | 'done'>('home');
  const [csvText, setCsvText] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ImportMapping>({});
  const [accountId, setAccountId] = useState<string | null>(null);
  const [defaultCategoryId, setDefaultCategoryId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<{ inserted: number; skippedDuplicates: number; skippedInvalid: number } | null>(null);
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<'none' | 'account' | 'category' | 'mapping'>('none');

  const accounts = useQuery(() => listAccounts(), []);
  const categories = useQuery(() => listCategories(), []);

  const selectedAccount = accounts.data?.find((entry) => entry.id === accountId) ?? null;
  const selectedCategory = categories.data?.find((entry) => entry.id === defaultCategoryId) ?? null;

  const storage = useQuery(async () => {
    const empty = await isDatabaseEmpty();
    return { empty };
  }, []);

  /* --------------------------------- Export -------------------------------- */

  const exportCsv = async () => {
    setBusy(true);
    try {
      const csv = await exportTransactionsCsv();
      await saveAndShareFile(`wallnut-transactions-${Date.now()}.csv`, csv, 'text/csv', 'Export transactions');
      toast.success('Transactions exported');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  };

  const exportSummary = async () => {
    setBusy(true);
    try {
      const csv = await exportMonthlySummaryCsv(1, money.currency);
      await saveAndShareFile(`wallnut-monthly-summary-${Date.now()}.csv`, csv, 'text/csv', 'Export summary');
      toast.success('Summary exported');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  };

  const exportBackup = async () => {
    setBusy(true);
    try {
      const backup = await createBackup();
      await saveAndShareFile(
        `wallnut-backup-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify(backup, null, 2),
        'application/json',
        'Save backup',
      );
      toast.success('Backup created');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Backup failed');
    } finally {
      setBusy(false);
    }
  };

  /* --------------------------------- Import -------------------------------- */

  const readPickedFile = async (): Promise<string | null> => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['text/csv', 'text/comma-separated-values', 'application/csv', 'application/json', 'text/plain', '*/*'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || !result.assets[0]) return null;
    const asset = result.assets[0];
    // Web provides the File object directly; native needs the filesystem.
    const file = (asset as unknown as { file?: File }).file;
    if (file && typeof file.text === 'function') return file.text();
    const { File } = await import('expo-file-system');
    const handle = new File(asset.uri);
    return handle.text();
  };

  const pickCsv = async () => {
    try {
      const text = await readPickedFile();
      if (!text) return;
      if (text.trim().startsWith('{')) {
        toast.error('That looks like a JSON backup — use Restore instead.');
        return;
      }
      const parsedHeaders = Object.keys(parseCsvHeader(text));
      setCsvText(text);
      setHeaders(parsedHeaders);
      setMapping(autoDetectMapping(parsedHeaders));
      setAccountId(accounts.data?.[0]?.id ?? null);
      setMode('map');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not read that file');
    }
  };

  const buildPreview = async () => {
    if (!accountId) {
      toast.error('Choose the account these transactions belong to.');
      return;
    }
    setBusy(true);
    try {
      const context: ImportContext = { mapping, accountId, defaultCategoryId };
      const { preview: next } = await previewCsv(csvText, context);
      setPreview(next);
      setMode('preview');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not parse the file');
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    if (!preview || !accountId) return;
    setBusy(true);
    try {
      const outcome = await commitImport(preview, { mapping, accountId, defaultCategoryId }, { includeDuplicates });
      setResult(outcome);
      setMode('done');
      toast.success(`${outcome.inserted} transactions imported`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  /* -------------------------------- Restore -------------------------------- */

  const restore = async () => {
    try {
      const text = await readPickedFile();
      if (!text) return;
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        toast.error('That file is not valid JSON.');
        return;
      }
      const validation = validateBackup(json);
      if (!validation.valid) {
        toast.error(validation.error ?? 'Not a Wallnut backup');
        return;
      }
      const backup = json as BackupFile;
      const summary = describeBackup(backup);
      const highlights = summary.rows
        .filter((row) => row.table !== 'settings')
        .slice(0, 5)
        .map((row) => `${row.rows} ${row.label.toLowerCase()}`)
        .join(' · ');
      const backupDate = new Date(backup.exportedAt);
      const dateLabel = Number.isNaN(backupDate.getTime()) ? 'an unknown date' : backupDate.toLocaleDateString();

      const choice = await confirm({
        title: 'Replace everything with this backup?',
        message: `Backed up ${dateLabel} — ${highlights || `${summary.totalRows} rows`}. Restoring wipes the current accounts, transactions, budgets, goals, debts, rules and settings, then re-imports the backup in one step (a failure rolls back completely).`,
        confirmLabel: 'Replace & restore',
        tone: 'danger',
      });
      if (!choice) return;

      setBusy(true);
      const outcome = await restoreBackup(backup, 'replace');
      toast.success(`Restored ${formatCount(outcome.inserted)} rows — balances recomputed`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Restore failed');
    } finally {
      setBusy(false);
    }
  };

  const wipe = async () => {
    const ok = await confirm({
      title: 'Delete all data?',
      message: 'Every account, transaction, budget, goal and debt is removed. This cannot be undone — export a backup first.',
      confirmLabel: 'Delete everything',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await clearAllData();
      toast.show('All data deleted');
      storage.refresh();
    } finally {
      setBusy(false);
    }
  };

  const loadSample = async () => {
    const ok = await confirm({
      title: 'Load sample data?',
      message: 'About 350 realistic transactions across 6 months, with budgets, goals and debts — great for exploring Wallnut.',
      confirmLabel: 'Load sample data',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await seedDemoData();
      toast.success('Sample data loaded');
    } finally {
      setBusy(false);
    }
  };

  /* ---------------------------------- UI ----------------------------------- */

  if (mode === 'map' || mode === 'preview' || mode === 'done') {
    return (
      <ImportWizard
        mode={mode}
        headers={headers}
        mapping={mapping}
        onMapping={setMapping}
        accountName={selectedAccount?.name ?? 'Choose account'}
        onPickAccount={() => setSheet('account')}
        categoryName={selectedCategory?.name ?? 'None'}
        onPickCategory={() => setSheet('category')}
        preview={preview}
        result={result}
        includeDuplicates={includeDuplicates}
        onIncludeDuplicates={setIncludeDuplicates}
        busy={busy}
        onBack={() => setMode(mode === 'map' ? 'home' : 'map')}
        onPreview={buildPreview}
        onImport={runImport}
        onDone={() => {
          setMode('home');
          setPreview(null);
          setResult(null);
        }}
        sheet={sheet}
        onSheet={setSheet}
        accounts={accounts.data ?? []}
        onPickAccountId={(id) => {
          setAccountId(id);
          setSheet('none');
        }}
        categories={(categories.data ?? []).map((category) => ({ id: category.id, label: category.name }))}
        onPickCategoryId={(id) => {
          setDefaultCategoryId(id);
          setSheet('none');
        }}
        money={money}
      />
    );
  }

  return (
    <ScrollScreen>
      <Row gap="sm" style={{ paddingTop: theme.spacing.md, paddingBottom: theme.spacing.lg }}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <AppText variant="title">Import & export</AppText>
          <AppText variant="caption" tone="muted">
            CSV, JSON backup and restore — all processed on this device
          </AppText>
        </View>
      </Row>

      <View style={{ gap: theme.spacing.lg }}>
        <ListGroup title="Export">
          <ListRow
            title="Transactions (CSV)"
            subtitle="Every transaction with account, category, tags and reference"
            icon="document-text-outline"
            onPress={exportCsv}
            disabled={busy}
            chevron
          />
          <ListRow
            title="Monthly summary (CSV)"
            subtitle="Income, expenses, refunds and net savings per month"
            icon="stats-chart-outline"
            onPress={exportSummary}
            disabled={busy}
            chevron
          />
          <ListRow
            title="Full backup (JSON)"
            subtitle="Everything: accounts, transactions, splits, budgets, goals, debts, rules, settings"
            icon="cloud-download-outline"
            onPress={exportBackup}
            disabled={busy}
            chevron
          />
        </ListGroup>

        <ListGroup title="Import">
          <ListRow
            title="Import CSV"
            subtitle="Map columns, preview, detect duplicates, then commit"
            icon="cloud-upload-outline"
            onPress={pickCsv}
            disabled={busy}
            chevron
          />
          <ListRow
            title="Restore JSON backup"
            subtitle="Replaces the current database with the backup's contents"
            icon="refresh-circle-outline"
            onPress={restore}
            disabled={busy}
            chevron
          />
          <ListRow
            title="Bank SMS (Android, future)"
            subtitle="Wired into the same pipeline when it ships — no data is read today"
            icon="chatbubble-ellipses-outline"
            disabled
          />
        </ListGroup>

        <ListGroup title="Sample data">
          <ListRow
            title="Load 6 months of sample data"
            subtitle="Realistic Indian transactions, budgets, goals and debts for exploring the app"
            icon="flask-outline"
            onPress={loadSample}
            disabled={busy}
          />
        </ListGroup>

        <ListGroup title="Danger zone">
          <ListRow
            title="Delete all data"
            subtitle="Removes everything from this device"
            icon="trash-outline"
            titleTone="negative"
            onPress={wipe}
            disabled={busy}
          />
        </ListGroup>

        <InfoBanner
          icon="lock-closed-outline"
          message="Files are generated locally. On Android they go through the share sheet; in the browser they download directly. Nothing is uploaded."
        />
      </View>

      {busy ? <LoadingBlock /> : null}
    </ScrollScreen>
  );
}

/* ------------------------------ Import wizard ------------------------------ */

function ImportWizard({
  mode,
  headers,
  mapping,
  onMapping,
  accountName,
  onPickAccount,
  categoryName,
  onPickCategory,
  preview,
  result,
  includeDuplicates,
  onIncludeDuplicates,
  busy,
  onBack,
  onPreview,
  onImport,
  onDone,
  sheet,
  onSheet,
  accounts,
  onPickAccountId,
  categories,
  onPickCategoryId,
  money,
}: {
  mode: 'map' | 'preview' | 'done';
  headers: string[];
  mapping: ImportMapping;
  onMapping: (mapping: ImportMapping) => void;
  accountName: string;
  onPickAccount: () => void;
  categoryName: string;
  onPickCategory: () => void;
  preview: ImportPreview | null;
  result: { inserted: number; skippedDuplicates: number; skippedInvalid: number } | null;
  includeDuplicates: boolean;
  onIncludeDuplicates: (value: boolean) => void;
  busy: boolean;
  onBack: () => void;
  onPreview: () => void;
  onImport: () => void;
  onDone: () => void;
  sheet: 'none' | 'account' | 'category' | 'mapping';
  onSheet: (sheet: 'none' | 'account' | 'category' | 'mapping') => void;
  accounts: { id: string; name: string; type: keyof typeof ACCOUNT_TYPE_LABELS }[];
  onPickAccountId: (id: string) => void;
  categories: { id: string; label: string }[];
  onPickCategoryId: (id: string) => void;
  money: ReturnType<typeof useMoney>;
}) {
  const theme = useTheme();
  const [editingField, setEditingField] = useState<keyof ImportMapping>('date');

  const fields: { key: keyof ImportMapping; label: string; required?: boolean }[] = [
    { key: 'date', label: 'Date', required: true },
    { key: 'amount', label: 'Amount', required: true },
    { key: 'debit', label: 'Debit (money out)' },
    { key: 'credit', label: 'Credit (money in)' },
    { key: 'type', label: 'Type column' },
    { key: 'merchant', label: 'Merchant' },
    { key: 'description', label: 'Description' },
    { key: 'category', label: 'Category' },
    { key: 'reference', label: 'Reference' },
    { key: 'notes', label: 'Notes' },
  ];

  return (
    <ScrollScreen>
      <Row gap="sm" style={{ paddingTop: theme.spacing.md, paddingBottom: theme.spacing.lg }}>
        <Pressable onPress={onBack} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <AppText variant="title">
            {mode === 'map' ? 'Map columns' : mode === 'preview' ? 'Preview import' : 'Import complete'}
          </AppText>
          <AppText variant="caption" tone="muted">
            {mode === 'map'
              ? `${headers.length} columns detected — match them to Wallnut fields`
              : mode === 'preview'
                ? 'Nothing is written until you confirm'
                : 'Your ledger has been updated'}
          </AppText>
        </View>
      </Row>

      {mode === 'map' ? (
        <View style={{ gap: theme.spacing.lg }}>
          <ListGroup title="Destination">
            <ListRow title="Account" value={accountName} onPress={onPickAccount} chevron />
            <ListRow title="Default category" subtitle="Used when a row has no category" value={categoryName} onPress={onPickCategory} chevron />
          </ListGroup>

          <View style={{ gap: theme.spacing.sm }}>
            <AppText variant="label" tone="muted">
              COLUMN MAPPING
            </AppText>
            {fields.map((field) => (
              <Pressable
                key={field.key}
                onPress={() => {
                  setEditingField(field.key);
                  onSheet('mapping');
                }}
                android_ripple={{ color: theme.colors.ripple }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingVertical: theme.spacing.md,
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: theme.colors.border,
                }}>
                <View>
                  <AppText variant="bodySmall">
                    {field.label}
                    {field.required ? <AppText tone="negative"> *</AppText> : null}
                  </AppText>
                  {(mapping[field.key] as string | undefined) ? (
                    <AppText variant="caption" tone="muted">
                      {String(mapping[field.key])}
                    </AppText>
                  ) : null}
                </View>
                <AppText variant="captionMedium" tone="accent">
                  {mapping[field.key] ? 'Change' : 'Choose'}
                </AppText>
              </Pressable>
            ))}
          </View>

          <InfoBanner
            message="Wallnut auto-detected these columns from your file's headers. Adjust anything that looks wrong before continuing — the preview will show exactly what would be imported."
          />

          <Button label="Preview import" size="lg" fullWidth onPress={onPreview} loading={busy} />
        </View>
      ) : null}

      {mode === 'preview' && preview ? (
        <View style={{ gap: theme.spacing.lg }}>
          <Row gap="sm">
            <StatPill label="New" value={preview.counts.new} tone="positive" />
            <StatPill label="Duplicates" value={preview.counts.duplicate} tone="warning" />
            <StatPill label="Invalid" value={preview.counts.invalid} tone="negative" />
          </Row>

          {preview.counts.duplicate > 0 ? (
            <Pressable onPress={() => onIncludeDuplicates(!includeDuplicates)} android_ripple={{ color: theme.colors.ripple }}>
              <Card style={{ borderColor: includeDuplicates ? theme.colors.warning : theme.colors.border }}>
                <Row justify="space-between">
                  <View style={{ flex: 1, gap: 4 }}>
                    <AppText variant="bodySmall">Import possible duplicates too</AppText>
                    <AppText variant="caption" tone="muted">
                      Off by default — a fingerprint of date, amount, merchant and account matched an existing record.
                    </AppText>
                  </View>
                  <Ionicons
                    name={includeDuplicates ? 'checkbox-outline' : 'square-outline'}
                    size={22}
                    color={includeDuplicates ? theme.colors.warning : theme.colors.muted}
                  />
                </Row>
              </Card>
            </Pressable>
          ) : null}

          <View style={{ gap: theme.spacing.sm }}>
            <AppText variant="label" tone="muted">
              ROWS
            </AppText>
            {preview.items.slice(0, 40).map((item) => (
              <View
                key={item.row}
                style={{
                  paddingVertical: theme.spacing.sm,
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: theme.colors.border,
                  opacity: item.status === 'invalid' ? 0.55 : 1,
                }}>
                <Row justify="space-between">
                  <View style={{ flex: 1, gap: 2 }}>
                    <AppText variant="bodySmall" numberOfLines={1}>
                      {item.draft.merchant || item.draft.description || '—'}
                    </AppText>
                    <AppText variant="caption" tone="muted" numberOfLines={1}>
                      {item.draft.date ?? 'no date'}
                      {item.draft.categoryName ? ` · ${item.draft.categoryName}` : ''}
                      {item.errors.length > 0 ? ` · ${item.errors.join(', ')}` : ''}
                      {item.status === 'duplicate' ? ' · possible duplicate' : ''}
                    </AppText>
                  </View>
                  {item.draft.amount !== null ? (
                    <MoneyText amount={item.draft.amount} variant="numericCaption" tone="neutral" />
                  ) : null}
                </Row>
              </View>
            ))}
            {preview.items.length > 40 ? (
              <AppText variant="caption" tone="muted">
                …and {preview.items.length - 40} more rows
              </AppText>
            ) : null}
          </View>

          <Button
            label={`Import ${includeDuplicates ? preview.counts.new + preview.counts.duplicate : preview.counts.new} transactions`}
            size="lg"
            fullWidth
            loading={busy}
            disabled={preview.counts.new + (includeDuplicates ? preview.counts.duplicate : 0) === 0}
            onPress={onImport}
          />
        </View>
      ) : null}

      {mode === 'done' && result ? (
        <View style={{ gap: theme.spacing.lg }}>
          <EmptyState
            icon="checkmark-circle-outline"
            title={`${result.inserted} transactions imported`}
            message={`${result.skippedDuplicates} duplicates and ${result.skippedInvalid} invalid rows were skipped. Duplicates are detected by a normalised fingerprint, never silently created.`}
            actionLabel="Back to import & export"
            onAction={onDone}
          />
          <Button
            label="Review imported transactions"
            variant="secondary"
            fullWidth
            onPress={() => {
              onDone();
              router.push('/review');
            }}
          />
        </View>
      ) : null}

      <BottomSheet visible={sheet === 'mapping'} onClose={() => onSheet('none')} title="Choose column">
        <View style={{ gap: theme.spacing.sm }}>
          <Pressable
            onPress={() => {
              onMapping({ ...mapping, [editingField]: undefined });
              onSheet('none');
            }}
            android_ripple={{ color: theme.colors.ripple }}
            style={{ paddingVertical: theme.spacing.md }}>
            <AppText variant="bodyMedium" tone="muted">
              Not mapped
            </AppText>
          </Pressable>
          {headers.map((header) => (
            <Pressable
              key={header}
              onPress={() => {
                onMapping({ ...mapping, [editingField]: header });
                onSheet('none');
              }}
              android_ripple={{ color: theme.colors.ripple }}
              style={{ paddingVertical: theme.spacing.md }}>
              <AppText variant="bodyMedium">{header}</AppText>
            </Pressable>
          ))}
        </View>
      </BottomSheet>

      <PickerSheet
        visible={sheet === 'account'}
        onClose={() => onSheet('none')}
        title="Import into account"
        items={accounts.map((account) => ({
          id: account.id,
          label: account.name,
          subtitle: ACCOUNT_TYPE_LABELS[account.type],
          icon: 'wallet-outline' as IconName,
        }))}
        onSelect={(item) => onPickAccountId(item.id)}
      />
      <PickerSheet
        visible={sheet === 'category'}
        onClose={() => onSheet('none')}
        title="Default category"
        items={categories.map((category) => ({ id: category.id, label: category.label, icon: 'pricetag-outline' as IconName }))}
        onSelect={(item) => onPickCategoryId(item.id)}
      />
    </ScrollScreen>
  );
}

function StatPill({ label, value, tone }: { label: string; value: number; tone: 'positive' | 'warning' | 'negative' }) {
  const theme = useTheme();
  const color = tone === 'positive' ? theme.colors.positive : tone === 'warning' ? theme.colors.warning : theme.colors.negative;
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

/** Parses just the header row so the wizard can offer column choices. */
function parseCsvHeader(text: string): Record<string, true> {
  const firstLine = text.split(/\r?\n/)[0] ?? '';
  const headers = firstLine
    .split(',')
    .map((cell) => cell.replace(/^"|"$/g, '').trim())
    .filter(Boolean);
  const record: Record<string, true> = {};
  for (const header of headers) record[header] = true;
  return record;
}
