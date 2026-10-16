import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/theme/theme';
import { ListGroup, Row, ScrollScreen, ScreenHeader } from '@/components/ui/layout';
import { AppText } from '@/components/ui/text';
import { Button, Chip, SettingSwitch } from '@/components/ui/controls';
import { Field } from '@/components/ui/sheets';
import { toast } from '@/stores/ui.store';
import { useSettingsStore } from '@/stores/settings.store';
import { clearAiCache } from '@/ai/cache';
import { testAiConnection } from '@/ai/client';

/**
 * AI & Intelligence settings. The DeepSeek key is user-supplied and stored in
 * Wallnut's local SQLite database only — nothing is bundled or uploaded
 * anywhere except the provider request the user triggers.
 */
export default function AiSettingsScreen() {
  const theme = useTheme();
  const ai = useSettingsStore((state) => state.ai);
  const updateAi = useSettingsStore((state) => state.update);
  const [keyDraft, setKeyDraft] = useState(ai.apiKey);
  const [reveal, setReveal] = useState(false);
  const [testing, setTesting] = useState(false);
  const [clearing, setClearing] = useState(false);

  // Keep the draft in sync if settings are restored/reset elsewhere.
  useEffect(() => {
    setKeyDraft(ai.apiKey);
  }, [ai.apiKey]);

  const saveKey = () => {
    updateAi('ai', { apiKey: keyDraft.trim() });
    if (keyDraft.trim()) toast.success('DeepSeek key saved on this device');
  };

  const test = async () => {
    if (keyDraft.trim() !== ai.apiKey.trim()) saveKey();
    setTesting(true);
    try {
      const result = await testAiConnection();
      if (result.ok) toast.success('DeepSeek connection works');
      else toast.error(result.error.message || 'Could not reach DeepSeek');
    } finally {
      setTesting(false);
    }
  };

  const clearCache = async () => {
    setClearing(true);
    try {
      await clearAiCache();
      toast.show('AI cache cleared');
    } catch {
      toast.error('Could not clear the AI cache');
    } finally {
      setClearing(false);
    }
  };

  const privacyOptions: { value: 'none' | 'anonymized' | 'detailed'; label: string; detail: string }[] = [
    { value: 'none', label: 'Never send', detail: 'AI features are disabled — nothing leaves the device.' },
    {
      value: 'anonymized',
      label: 'Anonymized summaries',
      detail: 'Aggregates and category names only. Merchant names are sent only when you explicitly ask about them (or for categorization).',
    },
    { value: 'detailed', label: 'Detailed analysis', detail: 'Merchant and category names may be included in insights.' },
  ];

  return (
    <ScrollScreen>
      <ScreenHeader title="AI & Automation" subtitle="DeepSeek explanations + natural-language money entry" />

      <View style={{ gap: theme.spacing.lg }}>
        <ListGroup title="Features">
          <SettingSwitch
            title="AI assistant"
            subtitle="Financial Intelligence screen and explanations"
            value={ai.enabled}
            onValueChange={(value) => updateAi('ai', { enabled: value })}
          />
          <SettingSwitch
            title="AI categorization"
            subtitle="Suggest a category for new transactions"
            value={ai.categorization}
            onValueChange={(value) => updateAi('ai', { categorization: value })}
          />
          <SettingSwitch
            title="AI insights"
            subtitle="One short observation on Home"
            value={ai.insights}
            onValueChange={(value) => updateAi('ai', { insights: value })}
          />
          <SettingSwitch
            title="Affordability explanations"
            subtitle="'Can I afford this?' answers"
            value={ai.affordability}
            onValueChange={(value) => updateAi('ai', { affordability: value })}
          />
          <SettingSwitch
            title="Monthly review"
            subtitle="AI summary in the monthly report"
            value={ai.monthlyReview}
            onValueChange={(value) => updateAi('ai', { monthlyReview: value })}
          />
        </ListGroup>

        <ListGroup title="AI Quick Entry">
          <SettingSwitch
            title="AI quick entry"
            subtitle="Type “Spent 450 at Zomato” and Wallnut builds the transaction"
            value={ai.quickEntry}
            onValueChange={(value) => updateAi('ai', { quickEntry: value })}
          />
          <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
            <AppText variant="captionMedium" tone="secondary">
              Confirmation mode
            </AppText>
            <Row gap="sm" wrap>
              {(
                [
                  { value: 'always', label: 'Always confirm', detail: 'Show the full review card before anything is saved.' },
                  { value: 'smart', label: 'Smart', detail: 'One-tap card for simple transactions; full review for transfers, debts, splits and large amounts.' },
                  { value: 'auto', label: 'Auto-save', detail: 'Trusted quick save for simple, high-confidence transactions (with undo). Transfers, debts, splits and large amounts still confirm.' },
                ] as const
              ).map((option) => (
                <Chip
                  key={option.value}
                  label={option.label}
                  selected={ai.confirmationMode === option.value}
                  onPress={() => updateAi('ai', { confirmationMode: option.value })}
                />
              ))}
            </Row>
            <AppText variant="caption" tone="muted">
              {(
                {
                  always: 'Show the full review card before anything is saved.',
                  smart: 'One-tap card for simple transactions; full review for transfers, debts, splits and large amounts.',
                  auto: 'Trusted quick save for simple, high-confidence transactions (with undo). Transfers, debts, splits and large amounts still confirm.',
                } as const
              )[ai.confirmationMode]}
            </AppText>
          </View>
          <SettingSwitch
            title="AI suggestions"
            subtitle="Example phrases while you type"
            value={ai.suggestions}
            onValueChange={(value) => updateAi('ai', { suggestions: value })}
          />
          <SettingSwitch
            title="Send financial context to AI"
            subtitle="Account, category, merchant, person and goal names — never balances or ledger rows"
            value={ai.shareContext}
            onValueChange={(value) => updateAi('ai', { shareContext: value })}
          />
          <View style={{ padding: theme.spacing.lg, gap: theme.spacing.xs }}>
            <Row justify="space-between">
              <AppText variant="bodySmall" tone="secondary">
                AI provider
              </AppText>
              <AppText variant="bodyMedium">{ai.provider === 'deepseek' ? 'DeepSeek' : ai.provider}</AppText>
            </Row>
            <AppText variant="caption" tone="muted">
              AI interprets the sentence; Wallnut's financial engine validates and saves. The model can never write to the
              database directly.
            </AppText>
          </View>
        </ListGroup>

        <ListGroup title="DeepSeek">
          <View style={{ padding: theme.spacing.lg, gap: theme.spacing.lg }}>
            <View style={{ gap: theme.spacing.xs }}>
              <AppText variant="captionMedium" tone="secondary">
                API key
              </AppText>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.sm,
                  backgroundColor: theme.colors.inputBackground,
                  borderRadius: theme.radius.md,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: theme.colors.border,
                  paddingHorizontal: theme.spacing.lg,
                  minHeight: 46,
                }}>
                <TextInput
                  value={keyDraft}
                  onChangeText={setKeyDraft}
                  onBlur={saveKey}
                  onSubmitEditing={saveKey}
                  placeholder="sk-…"
                  placeholderTextColor={theme.colors.muted}
                  secureTextEntry={!reveal}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{ flex: 1, color: theme.colors.text, fontFamily: theme.typography.body.fontFamily, fontSize: 15, paddingVertical: 8 }}
                />
                <Pressable onPress={() => setReveal((value) => !value)} hitSlop={8}>
                  <Ionicons name={reveal ? 'eye-off-outline' : 'eye-outline'} size={17} color={theme.colors.muted} />
                </Pressable>
                {keyDraft !== ai.apiKey ? <Button label="Save" size="sm" onPress={saveKey} /> : null}
              </View>
              <AppText variant="caption" tone="muted">
                Stored only in Wallnut's local database on this device. Never bundled into the app or sent anywhere except
                DeepSeek.
              </AppText>
            </View>

            <Field label="Model" value={ai.model} onChangeText={(value) => updateAi('ai', { model: value })} placeholder="deepseek-chat" />
            <Field label="Base URL" value={ai.baseUrl} onChangeText={(value) => updateAi('ai', { baseUrl: value })} placeholder="https://api.deepseek.com" />

            <Row gap="sm">
              <Button label={testing ? 'Testing…' : 'Test connection'} variant="secondary" onPress={() => void test()} disabled={testing || !ai.apiKey.trim()} />
            </Row>
          </View>
        </ListGroup>

        <ListGroup title="Privacy">
          <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
            <Row gap="sm" wrap>
              {privacyOptions.map((option) => (
                <Chip
                  key={option.value}
                  label={option.label}
                  selected={ai.privacy === option.value}
                  onPress={() => updateAi('ai', { privacy: option.value })}
                />
              ))}
            </Row>
            <AppText variant="caption" tone="muted">
              {privacyOptions.find((option) => option.value === ai.privacy)?.detail}
            </AppText>
          </View>
        </ListGroup>

        <ListGroup title="Usage & cache">
          <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
            <Row justify="space-between">
              <AppText variant="bodySmall" tone="secondary">
                Requests this month
              </AppText>
              <AppText variant="numericSmall">{ai.usageCount}</AppText>
            </Row>
            <Row justify="space-between">
              <AppText variant="bodySmall" tone="secondary">
                Estimated cost
              </AppText>
              <AppText variant="numericSmall">${ai.estimatedCostUsd.toFixed(3)}</AppText>
            </Row>
            <AppText variant="caption" tone="muted">
              Estimates use DeepSeek's published token prices. Identical requests are served from the local cache and cost
              nothing.
            </AppText>
            <Button
              label={clearing ? 'Clearing…' : 'Clear AI cache'}
              variant="secondary"
              onPress={() => void clearCache()}
              disabled={clearing}
            />
          </View>
        </ListGroup>

        <AppText variant="caption" tone="muted" style={{ paddingHorizontal: theme.spacing.xs, paddingBottom: theme.spacing.xl }}>
          Wallnut's financial engine calculates every number; DeepSeek only explains them. AI is optional and the app works
          fully without it.
        </AppText>
      </View>
    </ScrollScreen>
  );
}
