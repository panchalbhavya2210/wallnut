import React, { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { Card, IconName, ListGroup, ListRow, Row, ScreenHeader, ScrollScreen } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { Button, Chip, SegmentedControl } from '@/components/ui/controls';
import { EmptyState, InfoBanner, LoadingBlock } from '@/components/ui/feedback';
import { BottomSheet, DatePickerSheet, PickerSheet } from '@/components/ui/sheets';
import { confirm } from '@/components/ui/confirm';
import { useQuery } from '@/hooks/useQuery';
import { useMoney } from '@/hooks/useMoney';
import { useSettingsStore } from '@/stores/settings.store';
import { toast } from '@/stores/ui.store';
import { ACCOUNT_TYPE_LABELS, listAccounts } from '@/services/accounts.service';
import { listCategories } from '@/services/categories.service';
import {
  autoDetectMapping,
  commitImport,
  previewCsv,
  type ImportContext,
} from '@/services/import';
import { listStagedImportBatches, stageImportPreview } from '@/services/import/staging.service';
import {
  countTransactionExportRows,
  createBackup,
  describeBackup,
  exportMonthlySummaryCsv,
  exportTransactionsCsv,
  exportTransactionsJson,
  restoreBackup,
  validateBackup,
  type BackupFile,
  type ExportOptions,
} from '@/services/import/export.service';
import type { ImportMapping, ImportPreview } from '@/services/import/pipeline';
import { clearAllData, isDatabaseEmpty, seedDemoData } from '@/services/seed.service';
import { saveAndShareFile } from '@/utils/files';
import { formatCount } from '@/utils/format';
import { addDays, formatDayMonth, fromISODate, getPeriodRange, toISODate } from '@/utils/date';

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
  const busyRef = useRef(false);
  const monthStartDay = useSettingsStore((state) => state.general.monthStartDay);

  /* ------------------------------- Export setup ------------------------------ */
  const [exportFormat, setExportFormat] = useState<'csv' | 'json'>('csv');
  const [exportRange, setExportRange] = useState<'all' | 'thisMonth' | 'lastMonth' | '30d' | 'custom'>('all');
  const [customFrom, setCustomFrom] = useState(() => toISODate(addDays(new Date(), -29)));
  const [customTo, setCustomTo] = useState(() => toISODate(new Date()));
  const [datePicker, setDatePicker] = useState<'none' | 'from' | 'to'>('none');

  const exportOptions = useMemo<ExportOptions>(() => {
    if (exportRange === 'custom') {
      return { from: customFrom, to: customTo, includeTransfers: true };
    }
    if (exportRange === 'all') return { includeTransfers: true };
    const range = getPeriodRange(exportRange, { monthStartDay });
    return { from: toISODate(range.start), to: toISODate(range.end), includeTransfers: true };
  }, [exportRange, customFrom, customTo, monthStartDay]);

  const exportCount = useQuery(() => countTransactionExportRows(exportOptions), [JSON.stringify(exportOptions)]);

  const accounts = useQuery(() => listAccounts(), []);
  const categories = useQuery(() => listCategories(), []);
  const staged = useQuery(() => listStagedImportBatches(), []);

  const selectedAccount = accounts.data?.find((entry) => entry.id === accountId) ?? null;
  const selectedCategory = categories.data?.find((entry) => entry.id === defaultCategoryId) ?? null;

  const storage = useQuery(async () => {
    const empty = await isDatabaseEmpty();
    return { empty };
  }, []);

  /* --------------------------------- Export -------------------------------- */

  const exportTransactions = async () => {
    if (busyRef.current) return;
    const count = exportCount.data ?? 0;
    if (count === 0) {
      toast.show('No transactions in the selected range. Choose another range or add a transaction first.', 'neutral', {
        title: 'Nothing to export',
      });
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const content =
        exportFormat === 'csv'
          ? await exportTransactionsCsv(exportOptions)
          : await exportTransactionsJson(exportOptions);
      const filename = `wallnut-transactions-${toISODate(new Date())}.${exportFormat}`;
      const saved = await saveAndShareFile(
        filename,
        content,
        exportFormat === 'csv' ? 'text/csv' : 'application/json',
        exportFormat === 'csv' ? 'Export transactions as CSV' : 'Export transactions as JSON',
      );
      if (!saved.shared) {
        toast.show('The file is ready on this device, but this platform has no share sheet.', 'neutral', {
          title: 'Export ready',
        });
      } else {
        toast.success(`${count} transaction${count === 1 ? '' : 's'} · ${fileSize(saved.bytes)} written`, {
          title: 'Export ready',
        });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Export failed', { title: 'Export failed' });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const exportSummary = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const csv = await exportMonthlySummaryCsv(monthStartDay, money.currency);
      await saveAndShareFile(`wallnut-monthly-summary-${toISODate(new Date())}.csv`, csv, 'text/csv', 'Export summary');
      toast.success('Monthly summary is ready', { title: 'Export ready' });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Export failed', { title: 'Export failed' });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const exportBackup = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const backup = await createBackup();
      const saved = await saveAndShareFile(
        `wallnut-backup-${toISODate(new Date())}.json`,
        JSON.stringify(backup, null, 2),
        'application/json',
        'Save backup',
      );
      toast.success(`${fileSize(saved.bytes)} backup is ready`, { title: 'Backup ready' });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Backup failed', { title: 'Backup failed' });
    } finally {
      busyRef.current = false;
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
      const context: ImportContext = { mapping, accountId, defaultCategoryId, source: 'csv' };
      const { preview: next } = await previewCsv(csvText, context);
      setPreview(next);
      setMode('preview');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not parse the file');
    } finally {
      setBusy(false);
    }
  };

  /** Stages the preview for row-by-row review — nothing reaches the ledger yet. */
  const stageForReview = async () => {
    if (!preview || !accountId) return;
    setBusy(true);
    try {
      const stagedBatch = await stageImportPreview(preview, { source: 'csv', accountId, defaultCategoryId });
      toast.show(`${stagedBatch.staged} rows staged for review`);
      setMode('home');
      setPreview(null);
      router.replace(`/import/${stagedBatch.batchId}` as never);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not stage the file');
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    if (!preview || !accountId) return;
    setBusy(true);
    try {
      const outcome = await commitImport(preview, { mapping, accountId, defaultCategoryId, source: 'csv' }, { includeDuplicates });
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
        onReview={stageForReview}
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
      <ScreenHeader
        title="Import & export"
        subtitle="CSV, JSON backup and restore — all processed on this device"
      />

      <View style={{ gap: theme.spacing.lg }}>
        <Card>
          <View style={{ gap: theme.spacing.lg }}>
            <View style={{ gap: 4 }}>
              <AppText variant="titleSmall">Export transactions</AppText>
              <AppText variant="caption" tone="muted">
                Choose a format and period. Every amount stays signed; transfers are included but never counted as spending.
              </AppText>
            </View>

            <SegmentedControl
              options={[
                { value: 'csv', label: 'CSV' },
                { value: 'json', label: 'JSON' },
              ]}
              value={exportFormat}
              onChange={setExportFormat}
            />

            <View style={{ gap: theme.spacing.sm }}>
              <AppText variant="captionMedium" tone="secondary">
                Date range
              </AppText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                {(
                  [
                    ['all', 'All time'],
                    ['thisMonth', 'This month'],
                    ['lastMonth', 'Last month'],
                    ['30d', 'Last 30 days'],
                    ['custom', 'Custom'],
                  ] as const
                ).map(([value, label]) => (
                  <Chip key={value} label={label} selected={exportRange === value} onPress={() => setExportRange(value)} />
                ))}
              </View>
              {exportRange === 'custom' ? (
                <View style={{ flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'center' }}>
                  <Chip label={`From ${formatDayMonth(fromISODate(customFrom) ?? new Date())}`} onPress={() => setDatePicker('from')} />
                  <Chip label={`To ${formatDayMonth(fromISODate(customTo) ?? new Date())}`} onPress={() => setDatePicker('to')} />
                </View>
              ) : null}
            </View>

            {exportRange === 'custom' && customFrom > customTo ? (
              <InfoBanner tone="negative" message="The start date is after the end date. Choose a valid range before exporting." />
            ) : null}

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: theme.spacing.md,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.inputBackground,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.colors.border,
              }}>
              <View style={{ gap: 2, flex: 1 }}>
                <AppText variant="bodySmall">
                  {exportCount.loading && exportCount.data === null
                    ? 'Counting records…'
                    : `${formatCount(exportCount.data ?? 0)} transaction${(exportCount.data ?? 0) === 1 ? '' : 's'}`}
                </AppText>
                <AppText variant="caption" tone="muted">
                  {exportFormat === 'csv'
                    ? 'Date, type, amount, account, category, merchant, notes, tags'
                    : 'Structured records with split allocations and minor-unit amounts'}
                </AppText>
              </View>
              <Ionicons name={exportFormat === 'csv' ? 'grid-outline' : 'code-slash-outline'} size={20} color={theme.colors.accent.base} />
            </View>

            <Button
              label={
                exportRange === 'custom' && customFrom > customTo
                  ? 'Choose a valid range'
                  : `Export ${formatCount(exportCount.data ?? 0)} transactions`
              }
              icon="share-outline"
              size="lg"
              fullWidth
              loading={busy}
              disabled={busy || exportRange === 'custom' && customFrom > customTo}
              onPress={exportTransactions}
            />
          </View>
        </Card>

        <ListGroup title="Other exports">
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
          {(staged.data?.length ?? 0) > 0 ? (
            <ListRow
              title="Statement review waiting"
              subtitle={`${staged.data!.reduce((sum, batch) => sum + batch.pending, 0)} rows staged — confirm them before they reach the ledger`}
              icon="file-tray-full-outline"
              onPress={() => router.push(`/import/${staged.data![0]!.id}` as never)}
              chevron
            />
          ) : null}
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

      {busy ? <LoadingBlock label="Preparing your file…" /> : null}

      <DatePickerSheet
        visible={datePicker === 'from'}
        onClose={() => setDatePicker('none')}
        value={fromISODate(customFrom) ?? new Date()}
        title="Export from"
        onSelect={(date) => {
          setCustomFrom(toISODate(date));
          setDatePicker('none');
        }}
      />
      <DatePickerSheet
        visible={datePicker === 'to'}
        onClose={() => setDatePicker('none')}
        value={fromISODate(customTo) ?? new Date()}
        title="Export to"
        onSelect={(date) => {
          setCustomTo(toISODate(date));
          setDatePicker('none');
        }}
      />
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
  onReview,
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
  onReview: () => void;
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
      <ScreenHeader
        title={mode === 'map' ? 'Map columns' : mode === 'preview' ? 'Preview import' : 'Import complete'}
        subtitle={
          mode === 'map'
            ? `${headers.length} columns detected — match them to Wallnut fields`
            : mode === 'preview'
              ? 'Nothing is written until you confirm'
              : 'Your ledger has been updated'
        }
        onBack={onBack}
      />

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
            label={
              preview.counts.new + (includeDuplicates ? preview.counts.duplicate : 0) === 0
                ? 'Nothing to import'
                : `Review ${includeDuplicates ? preview.counts.new + preview.counts.duplicate : preview.counts.new} transactions`
            }
            size="lg"
            fullWidth
            loading={busy}
            disabled={preview.counts.new + (includeDuplicates ? preview.counts.duplicate : 0) === 0}
            onPress={onReview}
          />
          <Button
            label="Import without review"
            variant="secondary"
            fullWidth
            disabled={busy || preview.counts.new + (includeDuplicates ? preview.counts.duplicate : 0) === 0}
            onPress={onImport}
          />
          <AppText variant="caption" tone="muted" style={{ textAlign: 'center' }}>
            Review stages every row until you confirm — nothing reaches your ledger from the file alone.
          </AppText>
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

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
