import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/theme';
import { Card, IconName, Row } from '@/components/ui/layout';
import { AppText } from '@/components/ui/text';
import { Button, Chip, IconButton } from '@/components/ui/controls';
import { InfoBanner } from '@/components/ui/feedback';
import { DatePickerSheet, PickerSheet } from '@/components/ui/sheets';
import { useKeyboardHeight } from '@/hooks/useKeyboardHeight';
import { useMoney } from '@/hooks/useMoney';
import { toast } from '@/stores/ui.store';
import { useSettingsStore } from '@/stores/settings.store';
import { aiFeatureStatus, aiStatusMessage } from '@/ai/client';
import {
  analyzeQuickEntry,
  applyAnswer,
  applyCommandPatch,
  confirmQuickEntry,
  skipQuestion,
  type ExecutionResult,
  type QuickEntryAnalysis,
  type QuickEntryQuestion,
} from '@/ai/commands';
import { commandRows } from '@/ai/commands/resolve';
import { commandSummary } from '@/ai/commands/schema';
import { publishWidgetSnapshot } from '@/widgets/publish';
import { fromISODate, toISODate } from '@/utils/date';

/**
 * AI Quick Entry — natural language in, a strict command out, confirmed by the
 * user, executed by the existing financial services.
 *
 * The model never writes anything: `analyzeQuickEntry` only produces a typed
 * command; every byte of persistence below goes through the same services the
 * manual composer uses.
 */

const EXAMPLES = [
  'Spent 450 at Zomato',
  'Paid 1200 electricity from Kotak',
  'Got salary 42000',
  'Lent Rahul 2000',
  'Rahul paid me back 1000',
  'Move 5000 from Kotak to Cash',
  'Spent 2000 on Amazon with HDFC card',
  'Spent 500 yesterday',
  'Dinner 3000 split between me, Rahul and Amit',
  'Netflix 649 every month',
];

type Phase = 'input' | 'question' | 'confirm';

export default function QuickEntryScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  const params = useLocalSearchParams<{ type?: string }>();
  const typeHint: 'expense' | 'income' | 'transfer' | undefined =
    params.type === 'income' || params.type === 'transfer' || params.type === 'expense' ? params.type : undefined;
  const ai = useSettingsStore((state) => state.ai);
  const money = useMoney();
  const status = aiFeatureStatus('quickEntry');

  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [phase, setPhase] = useState<Phase>('input');
  const [analysis, setAnalysis] = useState<QuickEntryAnalysis | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answerText, setAnswerText] = useState('');
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'none' | 'account' | 'toAccount' | 'category' | 'date'>('none');

  const question = analysis && phase === 'question' ? (analysis.questions[questionIndex] ?? null) : null;

  const submit = async (sentenceOverride?: string) => {
    const sentence = (sentenceOverride ?? input).trim();
    if (!sentence || busy) return;
    setBusy(true);
    setErrorText(null);
    try {
      const result = await analyzeQuickEntry(sentence, { typeHint });
      if (!result.ok) {
        const friendly =
          result.error.code === 'invalid_response' || result.error.code === 'provider_error'
            ? 'Couldn’t understand that. Try: “Spent ₹450 at Zomato”'
            : aiStatusMessage(result.error);
        setErrorText(friendly);
        return;
      }
      begin(result.data);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not parse that.');
    } finally {
      setBusy(false);
    }
  };

  const execute = async (next: QuickEntryAnalysis) => {
    if (saving) return;
    setSaving(true);
    try {
      const result = await confirmQuickEntry(next);
      void publishWidgetSnapshot();
      announce(result);
      router.back();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save');
      setPhase('confirm');
    } finally {
      setSaving(false);
    }
  };

  const announce = (result: ExecutionResult) => {
    if (result.undo) {
      toast.undo(`Saved ${result.summary}`, () => {
        void result.undo?.().then(() => publishWidgetSnapshot());
      });
    } else {
      toast.success(result.summary);
    }
  };

  const begin = (next: QuickEntryAnalysis) => {
    setAnalysis(next);
    setQuestionIndex(0);
    setAnswerText('');
    setSelectedLabels([]);
    if (next.questions.length > 0) {
      setPhase('question');
      return;
    }
    if (next.decision === 'auto_save') {
      void execute(next);
      return;
    }
    setPhase('confirm');
  };

  const advance = (next: QuickEntryAnalysis) => {
    setAnalysis(next);
    if (next.questions.length > 0) {
      setQuestionIndex(0);
      setAnswerText('');
      setSelectedLabels([]);
      setPhase('question');
      return;
    }
    setPhase('confirm');
    if (next.decision === 'auto_save') void execute(next);
  };

  const chooseOption = (option: { id: string; label: string }) => {
    if (!analysis || !question) return;
    if (question.multi) {
      setSelectedLabels((current) =>
        current.includes(option.label) ? current.filter((label) => label !== option.label) : [...current, option.label],
      );
      return;
    }
    advance(applyAnswer(analysis, question, { optionId: option.id, optionLabel: option.label }));
  };

  const submitAnswer = () => {
    if (!analysis || !question) return;
    if (question.multi) {
      if (selectedLabels.length === 0 && !answerText.trim()) return;
      advance(applyAnswer(analysis, question, { labels: selectedLabels, text: answerText }));
      return;
    }
    if (!answerText.trim() && question.options.length === 0) return;
    if (!answerText.trim()) return;
    advance(applyAnswer(analysis, question, { text: answerText }));
  };

  const skip = () => {
    if (!analysis || !question) return;
    advance(skipQuestion(analysis, question));
  };

  const openComposer = () => {
    if (!analysis) return;
    const { command, resolved } = analysis;
    const amount = command.amount !== null ? String(command.amount) : undefined;

    // Lending/borrowing keep the debt editor; settlements live on Money owed;
    // splits/recurring/goals open their own screens. Nothing dead-ends.
    if (command.intent === 'CREATE_LENDING' || command.intent === 'CREATE_LOAN') {
      router.replace({
        pathname: '/debt/new',
        params: {
          direction: command.intent === 'CREATE_LENDING' ? 'lent' : 'borrowed',
          amount,
          person: resolved.counterparty?.name ?? command.person ?? undefined,
          date: command.date ?? undefined,
          accountId: resolved.account?.id ?? undefined,
          description: command.notes ?? undefined,
        },
      } as never);
      return;
    }
    if (command.intent === 'CREATE_SETTLEMENT') {
      router.replace('/debts' as never);
      return;
    }
    if (command.intent === 'CREATE_SHARED_EXPENSE') {
      router.replace({ pathname: '/shared/expense/new', params: { amount } } as never);
      return;
    }
    if (command.intent === 'CREATE_RECURRING') {
      router.replace('/recurring' as never);
      return;
    }
    if (command.intent === 'CREATE_GOAL_CONTRIBUTION') {
      router.replace('/goals' as never);
      return;
    }

    const type = command.intent === 'CREATE_TRANSFER' ? 'transfer' : command.intent === 'CREATE_INCOME' ? 'income' : 'expense';
    router.replace({
      pathname: '/transaction/new',
      params: {
        type,
        amount,
        accountId: resolved.account?.id ?? undefined,
        categoryId: resolved.category?.id ?? undefined,
        merchant: command.merchant ?? undefined,
        to: resolved.toAccount?.id ?? undefined,
        date: command.date ?? undefined,
        notes: command.notes ?? undefined,
      },
    } as never);
  };

  /* --------------------------- Inline card editing --------------------------- */

  const pickAccount = (accountId: string) => {
    setSheet('none');
    if (!analysis) return;
    if (accountId === '__none__') {
      setAnalysis(applyCommandPatch(analysis, { account: null }));
      return;
    }
    const account = analysis.local.accounts.find((entry) => entry.id === accountId);
    if (!account) return;
    const question: QuickEntryQuestion = {
      field: 'account',
      prompt: '',
      help: null,
      options: [],
      allowFreeText: false,
      multi: false,
      skippable: false,
      skipLabel: null,
    };
    setAnalysis(applyAnswer(analysis, question, { optionId: account.id, optionLabel: account.name }));
  };

  const pickToAccount = (accountId: string) => {
    setSheet('none');
    if (!analysis || accountId === '__none__') return;
    const account = analysis.local.accounts.find((entry) => entry.id === accountId);
    if (!account) return;
    const question: QuickEntryQuestion = {
      field: 'toAccount',
      prompt: '',
      help: null,
      options: [],
      allowFreeText: false,
      multi: false,
      skippable: false,
      skipLabel: null,
    };
    setAnalysis(applyAnswer(analysis, question, { optionId: account.id, optionLabel: account.name }));
  };

  const pickCategory = (categoryId: string) => {
    setSheet('none');
    if (!analysis) return;
    if (categoryId === '__none__') {
      setAnalysis(applyCommandPatch(analysis, { category: null }));
      return;
    }
    const category = analysis.local.categories.find((entry) => entry.id === categoryId);
    if (!category) return;
    const question: QuickEntryQuestion = {
      field: 'category',
      prompt: '',
      help: null,
      options: [],
      allowFreeText: false,
      multi: false,
      skippable: false,
      skipLabel: null,
    };
    setAnalysis(applyAnswer(analysis, question, { optionId: category.id, optionLabel: category.name }));
  };

  const pickDate = (value: Date) => {
    setSheet('none');
    if (!analysis) return;
    setAnalysis(applyCommandPatch(analysis, { date: toISODate(value) }));
  };

  /* ------------------------------- AI disabled ------------------------------ */

  if (status) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, paddingTop: insets.top }}>
        <View style={styles.header}>
          <IconButton icon="close" onPress={() => router.back()} accessibilityLabel="Close" />
          <AppText variant="titleSmall">Quick Entry</AppText>
          <View style={{ width: 40 }} />
        </View>
        <View style={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}>
          <InfoBanner
            tone="warning"
            message={
              status.code === 'not_configured'
                ? 'Add your DeepSeek API key to use natural-language entry. Manual entry keeps working offline.'
                : aiStatusMessage(status)
            }
          />
          <Button label="Open AI settings" fullWidth onPress={() => router.push('/settings/ai' as never)} />
          <Button
            label="Enter manually instead"
            variant="secondary"
            fullWidth
            onPress={() => router.replace('/transaction/new' as never)}
          />
        </View>
      </View>
    );
  }

  /* ---------------------------------- Render -------------------------------- */

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background, paddingTop: insets.top }}>
      <View style={styles.header}>
        <IconButton icon="close" onPress={() => router.back()} accessibilityLabel="Close" />
        <AppText variant="titleSmall">Quick Entry</AppText>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.sm,
          paddingBottom: theme.spacing.xxl + keyboard,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View style={{ gap: theme.spacing.lg }}>
          {/* Input */}
          {phase === 'input' ? (
            <>
              <Card>
                <TextInput
                  value={input}
                  onChangeText={setInput}
                  placeholder="What happened? e.g. Spent 450 at Zomato"
                  placeholderTextColor={theme.colors.muted}
                  multiline
                  autoFocus
                  editable={!busy}
                  style={{
                    minHeight: 64,
                    color: theme.colors.text,
                    fontFamily: theme.typography.body.fontFamily,
                    fontSize: 16,
                    lineHeight: 22,
                  }}
                />
              </Card>

              <Row gap="sm">
                <Button label="Ask Wallnut" size="lg" loading={busy} onPress={() => submit()} style={{ flex: 1 }} />
              </Row>

              {errorText ? <InfoBanner tone="warning" message={errorText} /> : null}

              {ai.suggestions ? (
                <View style={{ gap: theme.spacing.sm }}>
                  <AppText variant="captionMedium" tone="secondary">
                    Try
                  </AppText>
                  <Row gap="sm" wrap>
                    {EXAMPLES.map((example) => (
                      <Chip key={example} label={example} onPress={() => setInput(example)} />
                    ))}
                  </Row>
                  <AppText variant="caption" tone="muted">
                    AI interprets your sentence, shows what it understood, and only your confirmation writes to the ledger.
                  </AppText>
                </View>
              ) : null}
            </>
          ) : null}

          {/* Follow-up question */}
          {phase === 'question' && question ? (
            <>
              <Card>
                <View style={{ gap: theme.spacing.md }}>
                  <AppText variant="bodyMedium">{question.prompt}</AppText>
                  {question.help ? (
                    <AppText variant="caption" tone="muted">
                      {question.help}
                    </AppText>
                  ) : null}
                  {question.options.length > 0 ? (
                    <Row gap="sm" wrap>
                      {question.options.map((option) => (
                        <Chip
                          key={option.id}
                          label={option.subtitle ? `${option.label} · ${option.subtitle}` : option.label}
                          selected={question.multi ? selectedLabels.includes(option.label) : false}
                          onPress={() => chooseOption(option)}
                        />
                      ))}
                    </Row>
                  ) : null}
                  {question.allowFreeText ? (
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
                        minHeight: 46,
                      }}>
                      <TextInput
                        value={answerText}
                        onChangeText={setAnswerText}
                        placeholder={question.field === 'amount' ? '450' : question.multi ? 'Me, Rahul, Amit' : 'Type a name'}
                        placeholderTextColor={theme.colors.muted}
                        keyboardType={question.field === 'amount' ? 'decimal-pad' : 'default'}
                        autoFocus
                        onSubmitEditing={submitAnswer}
                        style={{
                          flex: 1,
                          color: theme.colors.text,
                          fontFamily: theme.typography.body.fontFamily,
                          fontSize: 15,
                          paddingVertical: 8,
                        }}
                      />
                      <IconButton icon="arrow-forward" onPress={submitAnswer} accessibilityLabel="Continue" />
                    </View>
                  ) : null}
                  <Row gap="sm">
                    {question.options.length > 0 || question.multi ? (
                      <Button label="Continue" onPress={submitAnswer} style={{ flex: 1 }} />
                    ) : null}
                    {question.skippable ? (
                      <Button label={question.skipLabel ?? 'Skip'} variant="secondary" onPress={skip} style={{ flex: 1 }} />
                    ) : null}
                    <Button label="Back" variant="ghost" onPress={() => setPhase('input')} />
                  </Row>
                </View>
              </Card>
            </>
          ) : null}

          {/* Confirmation */}
          {phase === 'confirm' && analysis ? (
            <>
              <Card>
                <View style={{ gap: theme.spacing.sm }}>
                  <Row justify="space-between">
                    <AppText variant="captionMedium" tone="secondary">
                      {analysis.decision === 'compact_confirm' ? 'Ready to save' : commandSummary(analysis.command)}
                    </AppText>
                    <AppText variant="caption" tone="muted">
                      {Math.round(analysis.command.confidence * 100)}% sure
                    </AppText>
                  </Row>
                  {commandRows(analysis.resolved, analysis.local).map((row) =>
                    row.field ? (
                      <Pressable
                        key={row.label}
                        onPress={() => setSheet(row.field as 'account' | 'toAccount' | 'category' | 'date')}
                        accessibilityRole="button"
                        accessibilityLabel={`Edit ${row.label.toLowerCase()}`}
                        android_ripple={{ color: theme.colors.ripple }}
                        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <AppText variant="bodySmall" tone="secondary">
                          {row.label}
                        </AppText>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 }}>
                          <AppText
                            variant="bodyMedium"
                            tone={row.tone === 'positive' ? 'positive' : row.tone === 'negative' ? 'negative' : 'accent'}
                            style={{ flexShrink: 1, textAlign: 'right' }}>
                            {row.value}
                          </AppText>
                          <Ionicons name="chevron-down" size={13} color={theme.colors.muted} />
                        </View>
                      </Pressable>
                    ) : (
                      <Row key={row.label} justify="space-between">
                        <AppText variant="bodySmall" tone="secondary">
                          {row.label}
                        </AppText>
                        <AppText
                          variant="bodyMedium"
                          tone={row.tone === 'positive' ? 'positive' : row.tone === 'negative' ? 'negative' : undefined}
                          style={{ flexShrink: 1, textAlign: 'right' }}>
                          {row.value}
                        </AppText>
                      </Row>
                    ),
                  )}
                </View>
              </Card>

              {analysis.resolved.unknown.category ? (
                <InfoBanner
                  tone="warning"
                  message={`I don’t know the category “${analysis.resolved.unknown.category}” — tap Category to pick one.`}
                />
              ) : null}

              {analysis.command.intent === 'CREATE_LENDING' || analysis.command.intent === 'CREATE_LOAN' ? (
                <InfoBanner message="Recorded as money owed — never counted as spending or income. Pick an account above to move the cash, or keep “Track only”." />
              ) : null}

              {analysis.command.intent === 'CREATE_SETTLEMENT' ? (
                <InfoBanner message="This records a repayment against the oldest open debt — never income or spending." />
              ) : null}

              <Row gap="sm">
                <Button label="Save" size="lg" loading={saving} onPress={() => execute(analysis)} style={{ flex: 1 }} />
                <Button label="Edit" size="lg" variant="secondary" onPress={openComposer} />
              </Row>
              <Button label="Cancel" variant="ghost" onPress={() => setPhase('input')} />
            </>
          ) : null}
        </View>
      </ScrollView>

      {/* Inline editors for the confirmation card */}
      {analysis ? (
        <>
          <PickerSheet
            visible={sheet === 'account' || sheet === 'toAccount'}
            onClose={() => setSheet('none')}
            title={sheet === 'toAccount' ? 'Where should it go?' : 'Which account?'}
            items={[
              ...(sheet === 'account' &&
              (analysis.command.intent === 'CREATE_LENDING' ||
                analysis.command.intent === 'CREATE_LOAN' ||
                analysis.command.intent === 'CREATE_SETTLEMENT' ||
                analysis.command.intent === 'CREATE_GOAL_CONTRIBUTION')
                ? [{ id: '__none__', label: 'Track only', subtitle: 'No cash movement', icon: 'remove-circle-outline' as IconName }]
                : []),
              ...analysis.local.accounts.map((account) => ({
                id: account.id,
                label: account.name,
                subtitle: money.format(account.currentBalance),
                icon: 'wallet-outline' as IconName,
              })),
            ]}
            selectedId={sheet === 'toAccount' ? (analysis.resolved.toAccount?.id ?? '') : (analysis.resolved.account?.id ?? '__none__')}
            onSelect={(item) => (sheet === 'toAccount' ? pickToAccount(item.id) : pickAccount(item.id))}
          />
          <PickerSheet
            visible={sheet === 'category'}
            onClose={() => setSheet('none')}
            title="Category"
            items={[
              { id: '__none__', label: 'Leave uncategorised', icon: 'remove-circle-outline' as IconName },
              ...analysis.local.categories
                .filter((category) => !category.isArchived && !category.parentId)
                .filter((category) => {
                  const wantsIncome =
                    analysis.command.transactionType === 'INCOME' || analysis.command.intent === 'CREATE_INCOME';
                  return category.type === (wantsIncome ? 'income' : 'expense');
                })
                .map((category) => ({
                  id: category.id,
                  label: category.name,
                  icon: (category.icon as IconName) ?? 'pricetag-outline',
                })),
            ]}
            selectedId={analysis.resolved.category?.id ?? '__none__'}
            onSelect={(item) => pickCategory(item.id)}
          />
          <DatePickerSheet
            visible={sheet === 'date'}
            onClose={() => setSheet('none')}
            value={fromISODate(analysis.command.date ?? '') ?? new Date()}
            onSelect={pickDate}
            title="Date"
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
});
