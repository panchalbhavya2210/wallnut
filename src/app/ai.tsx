import React, { useCallback, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/theme';
import { AppText } from '@/components/ui/text';
import { IconButton, Button } from '@/components/ui/controls';
import { Card, ScreenHeader } from '@/components/ui/layout';
import { useSettingsStore } from '@/stores/settings.store';
import { aiFeatureStatus, aiStatusMessage } from '@/ai/client';
import { buildFinanceContext } from '@/ai/context';
import { explainAssistant } from '@/ai/features';
import { detectIntent } from '@/ai/intents';
import { resolveIntent } from '@/ai/resolve';

/**
 * Financial Intelligence — Wallnut's assistant.
 *
 * Deterministic first: the question is matched to a financial-engine query and
 * the calculated fact is always shown. DeepSeek is asked only to explain that
 * fact (or, for unmatched questions, to answer strictly from a compact
 * snapshot). When AI is unavailable, the calculated answer still works.
 */

const SUGGESTIONS = [
  'Where did my money go this month?',
  'How much did I spend on food?',
  'Why did I spend more this month?',
  'What was my biggest expense?',
  'How much did I save?',
  'How much do I owe?',
  'How much have I lent?',
  'Which category increased the most?',
  'Can I afford a ₹20,000 purchase?',
];

interface Message {
  id: number;
  role: 'user' | 'ai';
  text: string;
  detail?: string;
  href?: string;
  hrefLabel?: string;
  note?: string;
}

let messageId = 0;

export default function AiAssistantScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const monthStartDay = useSettingsStore((state) => state.general.monthStartDay);
  const currency = useSettingsStore((state) => state.general.currency);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const statusError = aiFeatureStatus('assistant');

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, []);

  const ask = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || busy) return;
      setInput('');
      setBusy(true);
      const userId = ++messageId;
      setMessages((current) => [...current, { id: userId, role: 'user', text }]);
      scrollToEnd();

      try {
        const intent = detectIntent(text);
        const resolved = await resolveIntent(intent, { monthStartDay });

        if (resolved) {
          const aiMessageId = ++messageId;
          setMessages((current) => [
            ...current,
            { id: aiMessageId, role: 'ai', text: resolved.fact, href: resolved.href, hrefLabel: 'Open' },
          ]);
          scrollToEnd();

          if (!statusError) {
            const context = await buildFinanceContext({ monthStartDay, currency });
            const result = await explainAssistant({ question: text, fact: resolved.fact, data: resolved.data, context });
            if (result.ok) {
              setMessages((current) =>
                current.map((message) => (message.id === aiMessageId ? { ...message, detail: result.data.answer } : message)),
              );
            } else {
              setMessages((current) =>
                current.map((message) =>
                  message.id === aiMessageId ? { ...message, note: aiStatusMessage(result.error) } : message,
                ),
              );
            }
          }
          scrollToEnd();
          return;
        }

        if (statusError) {
          setMessages((current) => [
            ...current,
            {
              id: ++messageId,
              role: 'ai',
              text:
                'I can answer questions like “How much did I spend on food?”, “What was my biggest expense?” or “Can I afford ₹20,000?”.',
              note: aiStatusMessage(statusError),
            },
          ]);
          scrollToEnd();
          return;
        }

        const context = await buildFinanceContext({ monthStartDay, currency });
        const result = await explainAssistant({
          question: text,
          fact: 'No direct Wallnut metric matched this question. Answer only from the snapshot; if it does not contain the answer, say you cannot answer that yet.',
          data: {},
          context,
        });
        setMessages((current) => [
          ...current,
          result.ok
            ? { id: ++messageId, role: 'ai', text: result.data.answer }
            : { id: ++messageId, role: 'ai', text: 'I could not answer that right now.', note: aiStatusMessage(result.error) },
        ]);
        scrollToEnd();
      } catch (error) {
        setMessages((current) => [
          ...current,
          {
            id: ++messageId,
            role: 'ai',
            text: 'Something went wrong while answering.',
            note: error instanceof Error ? error.message : 'Unknown error',
          },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [busy, monthStartDay, currency, statusError, scrollToEnd],
  );

  const openAiSettings = () => router.push('/settings/ai' as never);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}>
      <View style={{ flex: 1, paddingHorizontal: theme.spacing.lg, paddingTop: insets.top }}>
        <ScreenHeader
          title="Financial Intelligence"
          subtitle="Ask Wallnut anything about your money"
          hint={{ id: 'ai', message: 'Ask about your own numbers — Wallnut calculates the answer from your ledger and DeepSeek phrases it. Add a key in Settings → AI & Automation to turn explanations on.' }}
        />

        <Pressable
          onPress={() => router.push('/quick-entry' as never)}
          android_ripple={{ color: theme.colors.ripple }}
          accessibilityRole="button"
          accessibilityLabel="Quick entry"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.md,
            padding: theme.spacing.lg,
            marginBottom: theme.spacing.md,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.colors.accent.soft,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: `${theme.colors.accent.base}44`,
          }}>
          <Ionicons name="flash-outline" size={18} color={theme.colors.accent.base} />
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="bodyMedium" tone="accent">
              Quick entry
            </AppText>
            <AppText variant="caption" tone="muted">
              “Spent 450 at Zomato” — AI interprets, you confirm
            </AppText>
          </View>
          <Ionicons name="chevron-forward" size={16} color={theme.colors.accent.base} />
        </Pressable>

        {statusError ? (
          <Card style={{ marginBottom: theme.spacing.md, backgroundColor: theme.colors.inputBackground }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
              <Ionicons name="sparkles-outline" size={18} color={theme.colors.muted} />
              <View style={{ flex: 1 }}>
                <AppText variant="bodySmall" tone="secondary">
                  {aiStatusMessage(statusError)}
                </AppText>
                <AppText variant="caption" tone="muted" style={{ marginTop: 2 }}>
                  Wallnut still answers directly from your data below.
                </AppText>
              </View>
              <Button label="Settings" size="sm" variant="secondary" onPress={openAiSettings} />
            </View>
          </Card>
        ) : null}

        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: theme.spacing.lg, gap: theme.spacing.md }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {messages.length === 0 ? (
            <View style={{ gap: theme.spacing.md, paddingTop: theme.spacing.sm }}>
              <AppText variant="bodySmall" tone="secondary">
                Ask about your own numbers. Wallnut calculates the answer from your ledger, and DeepSeek turns it into
                plain language. Suggested questions are below the conversation.
              </AppText>
            </View>
          ) : null}

          {messages.map((message) =>
            message.role === 'user' ? (
              <View
                key={message.id}
                style={{
                  alignSelf: 'flex-end',
                  maxWidth: '86%',
                  backgroundColor: theme.colors.accent.soft,
                  borderRadius: theme.radius.lg,
                  borderBottomRightRadius: theme.radius.xs,
                  paddingHorizontal: theme.spacing.lg,
                  paddingVertical: theme.spacing.md,
                }}>
                <AppText variant="bodySmall">{message.text}</AppText>
              </View>
            ) : (
              <Card key={message.id} style={{ maxWidth: '94%' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, marginBottom: theme.spacing.sm }}>
                  <View
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 7,
                      backgroundColor: theme.colors.accent.soft,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                    <Ionicons name="sparkles-outline" size={12} color={theme.colors.accent.base} />
                  </View>
                  <AppText variant="label" tone="muted">
                    WALLNUT
                  </AppText>
                </View>
                <AppText variant="bodySmall">{message.detail ?? message.text}</AppText>
                {message.detail ? (
                  <AppText variant="caption" tone="muted" style={{ marginTop: theme.spacing.sm }}>
                    Calculated from your ledger{message.note ? ` · ${message.note}` : ''}
                  </AppText>
                ) : message.note ? (
                  <AppText variant="caption" tone="muted" style={{ marginTop: theme.spacing.sm }}>
                    {message.note}
                  </AppText>
                ) : null}
                {message.href ? (
                  <Pressable
                    onPress={() => router.push(message.href as never)}
                    style={({ pressed }) => ({ marginTop: theme.spacing.sm, opacity: pressed ? 0.7 : 1 })}>
                    <AppText variant="captionMedium" tone="accent">
                      {message.hrefLabel ?? 'Open'} →
                    </AppText>
                  </Pressable>
                ) : null}
              </Card>
            ),
          )}

          {busy ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingLeft: theme.spacing.xs }}>
              <Ionicons name="ellipsis-horizontal" size={16} color={theme.colors.muted} />
              <AppText variant="caption" tone="muted">
                Checking your numbers…
              </AppText>
            </View>
          ) : null}
        </ScrollView>

        {/* Suggested questions — always available, scrollable, above the input */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={{ gap: theme.spacing.sm, paddingRight: theme.spacing.lg, paddingBottom: theme.spacing.sm }}>
          {SUGGESTIONS.map((suggestion) => (
            <Pressable
              key={suggestion}
              onPress={() => void ask(suggestion)}
              android_ripple={{ color: theme.colors.ripple }}
              style={({ pressed }) => ({
                paddingHorizontal: theme.spacing.md,
                paddingVertical: theme.spacing.sm,
                borderRadius: theme.radius.full,
                backgroundColor: theme.colors.inputBackground,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.colors.border,
                opacity: pressed ? 0.8 : 1,
              })}>
              <AppText variant="caption" tone="secondary">
                {suggestion}
              </AppText>
            </Pressable>
          ))}
        </ScrollView>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.sm,
            paddingBottom: Math.max(insets.bottom, theme.spacing.sm),
            paddingTop: theme.spacing.sm,
          }}>
          <View
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.sm,
              backgroundColor: theme.colors.inputBackground,
              borderRadius: theme.radius.lg,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.colors.border,
              paddingHorizontal: theme.spacing.md,
              minHeight: 46,
            }}>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="Ask about your money…"
              placeholderTextColor={theme.colors.muted}
              style={{ flex: 1, color: theme.colors.text, fontFamily: theme.typography.body.fontFamily, fontSize: 15, paddingVertical: 8 }}
              onSubmitEditing={() => void ask(input)}
              returnKeyType="send"
            />
          </View>
          <IconButton
            icon="arrow-up"
            onPress={() => void ask(input)}
            accessibilityLabel="Send question"
            color={busy || !input.trim() ? theme.colors.muted : theme.colors.accent.base}
          />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
