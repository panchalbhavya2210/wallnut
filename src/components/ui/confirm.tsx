import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { create } from 'zustand';

import { useTheme } from '@/theme/theme';
import { AppText } from '@/components/ui/text';
import { Button } from '@/components/ui/controls';
import { BottomSheet } from '@/components/ui/sheets';

/**
 * Imperative confirmation sheet.
 *
 *   const ok = await confirm({ title: 'Delete transaction?', tone: 'danger' });
 *
 * Rendered once in the root layout so every screen gets consistent, safe
 * destructive actions.
 */

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
}

interface ConfirmState {
  visible: boolean;
  options: ConfirmOptions | null;
  resolver: ((value: boolean) => void) | null;
  open: (options: ConfirmOptions, resolver: (value: boolean) => void) => void;
  close: (value: boolean) => void;
}

const useConfirmStore = create<ConfirmState>((set, get) => ({
  visible: false,
  options: null,
  resolver: null,
  open: (options, resolver) => set({ visible: true, options, resolver }),
  close: (value) => {
    const { resolver } = get();
    resolver?.(value);
    set({ visible: false, resolver: null });
  },
}));

export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    useConfirmStore.getState().open(options, resolve);
  });
}

export function ConfirmHost() {
  const theme = useTheme();
  const { visible, options, close } = useConfirmStore();
  // Keep options mounted during the closing animation.
  const [cached, setCached] = useState<ConfirmOptions | null>(null);
  useEffect(() => {
    if (options) setCached(options);
  }, [options]);

  const current = options ?? cached;
  if (!current) return null;

  return (
    <BottomSheet visible={visible} onClose={() => close(false)} maxHeightRatio={0.5}>
      <View style={{ gap: theme.spacing.sm, paddingBottom: theme.spacing.sm }}>
        <AppText variant="titleSmall">{current.title}</AppText>
        {current.message ? (
          <AppText variant="bodySmall" tone="secondary">
            {current.message}
          </AppText>
        ) : null}
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.lg }}>
          <Button
            label={current.cancelLabel ?? 'Cancel'}
            variant="secondary"
            onPress={() => close(false)}
            style={{ flex: 1 }}
          />
          <Button
            label={current.confirmLabel ?? 'Confirm'}
            variant={current.tone === 'danger' ? 'danger' : 'primary'}
            onPress={() => close(true)}
            style={{ flex: 1 }}
          />
        </View>
      </View>
    </BottomSheet>
  );
}

/** Small helper used by list rows: a pressed state without the default opacity flash. */
export function PressableRow({
  children,
  onPress,
  onLongPress,
  style,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: object;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        style,
        pressed ? { backgroundColor: theme.colors.pressed, borderRadius: theme.radius.md } : null,
      ]}>
      {children}
    </Pressable>
  );
}

export const confirmStyles = StyleSheet.create({
  hidden: { display: 'none' },
});
