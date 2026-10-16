import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Font from 'expo-font';

import { useTheme } from '@/theme/theme';
import { accents, type AccentName } from '@/theme/colors';
import { FONT_OPTIONS, fontOption } from '@/theme/fonts';
import { Card, ListGroup, Row, ScrollScreen } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { Chip, SettingSwitch } from '@/components/ui/controls';
import { useSettingsStore } from '@/stores/settings.store';
import { useMoney } from '@/hooks/useMoney';
import { toast } from '@/stores/ui.store';
import { getDevicePaletteSeed, type DevicePaletteResult } from '@/services/device-palette/device-palette.service';

/**
 * Appearance — theme, accent, text size and motion. Changes apply instantly
 * because the theme is built from this store on every render.
 */
export default function AppearanceSettings() {
  const theme = useTheme();
  const money = useMoney();
  const appearance = useSettingsStore((state) => state.appearance);
  const updateAppearance = useSettingsStore((state) => state.update);
  const [devicePalette, setDevicePalette] = useState<DevicePaletteResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getDevicePaletteSeed()
      .then((result) => {
        if (!cancelled) setDevicePalette(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Load every family (local assets) so the picker can render each name in its
  // own typeface. The app itself only ever loads the active family.
  const [fontsLoaded, setFontsLoaded] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const option of FONT_OPTIONS) {
        try {
          await Font.loadAsync(option.modules);
          if (cancelled) return;
          setFontsLoaded((current) => ({ ...current, [option.id]: true }));
        } catch {
          // The name falls back to the active family; the option still applies.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const themeOptions: { value: 'system' | 'light' | 'dark'; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { value: 'system', label: 'System', icon: 'phone-portrait-outline' },
    { value: 'light', label: 'Light', icon: 'sunny-outline' },
    { value: 'dark', label: 'Dark', icon: 'moon-outline' },
  ];

  return (
    <ScrollScreen>
      <Header title="Appearance" />

        <View style={{ gap: theme.spacing.lg }}>
          <ListGroup title="Presets">
            <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
              <Row gap="sm" wrap>
                {(
                  [
                    { label: 'Dark · Magenta', theme: 'dark', accent: 'magenta', amoled: false },
                    { label: 'AMOLED · Magenta', theme: 'dark', accent: 'magenta', amoled: true },
                    { label: 'AMOLED · Blue', theme: 'dark', accent: 'blue', amoled: true },
                    { label: 'Light · Blue', theme: 'light', accent: 'blue', amoled: false },
                    { label: 'Light · Magenta', theme: 'light', accent: 'magenta', amoled: false },
                  ] as const
                ).map((preset) => (
                  <Chip
                    key={preset.label}
                    label={preset.label}
                    selected={
                      appearance.theme === preset.theme &&
                      appearance.accent === preset.accent &&
                      appearance.amoled === preset.amoled
                    }
                    onPress={() =>
                      updateAppearance('appearance', {
                        theme: preset.theme,
                        accent: preset.accent as AccentName,
                        amoled: preset.amoled,
                      })
                    }
                  />
                ))}
              </Row>
              <AppText variant="caption" tone="muted">
                One tap sets the full look — theme, accent and canvas. Every part stays customisable below.
              </AppText>
            </View>
          </ListGroup>

          <ListGroup title="Theme">
            <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
              <Row gap="sm">
                {themeOptions.map((option) => (
                  <Pressable
                    key={option.value}
                    onPress={() => updateAppearance('appearance', { theme: option.value })}
                    android_ripple={{ color: theme.colors.ripple }}
                    style={{
                      flex: 1,
                      alignItems: 'center',
                      gap: 6,
                      paddingVertical: theme.spacing.lg,
                      borderRadius: theme.radius.md,
                      borderWidth: StyleSheet.hairlineWidth * 2,
                      borderColor: appearance.theme === option.value ? theme.colors.accent.base : theme.colors.border,
                      backgroundColor: appearance.theme === option.value ? theme.colors.accent.soft : theme.colors.inputBackground,
                    }}>
                    <Ionicons
                      name={option.icon}
                      size={20}
                      color={appearance.theme === option.value ? theme.colors.accent.base : theme.colors.textSecondary}
                    />
                    <AppText variant="bodySmall" tone={appearance.theme === option.value ? 'accent' : 'secondary'}>
                      {option.label}
                    </AppText>
                  </Pressable>
                ))}
              </Row>
              <AppText variant="caption" tone="muted">
                System follows your device setting automatically.
              </AppText>
              {appearance.theme !== 'light' ? (
                <View style={{ borderRadius: theme.radius.md, backgroundColor: theme.colors.inputBackground, overflow: 'hidden' }}>
                  <SettingSwitch
                    title="AMOLED black"
                    subtitle="True-black canvas on OLED screens — cards keep their separation"
                    value={appearance.amoled}
                    onValueChange={(value) => updateAppearance('appearance', { amoled: value })}
                  />
                </View>
              ) : null}
            </View>
          </ListGroup>

          <ListGroup title="Accent colour">
            <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
              <Row gap="sm" wrap>
                {(Object.keys(accents) as AccentName[]).map((name) => {
                  const tokens = theme.mode === 'dark' ? accents[name].dark : accents[name].light;
                  const selected = appearance.accent === name;
                  return (
                    <Pressable
                      key={name}
                      onPress={() => {
                        updateAppearance('appearance', { accent: name });
                        toast.show(`${accents[name].label} accent`);
                      }}
                      android_ripple={{ color: theme.colors.ripple }}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 8,
                        paddingHorizontal: theme.spacing.md,
                        height: 38,
                        borderRadius: theme.radius.full,
                        borderWidth: StyleSheet.hairlineWidth * 2,
                        borderColor: selected ? tokens.base : theme.colors.border,
                        backgroundColor: selected ? `${tokens.base}18` : 'transparent',
                      }}>
                      <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: tokens.base }} />
                      <AppText variant="bodySmall" tone={selected ? 'primary' : 'secondary'}>
                        {accents[name].label}
                      </AppText>
                    </Pressable>
                  );
                })}
              </Row>
              <AppText variant="caption" tone="muted">
                Used for buttons, selected states and charts. Income and expense colours never change.
              </AppText>
            </View>
          </ListGroup>

          <ListGroup title="Palette">
            <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
              <Row gap="sm">
                <Chip
                  label="Wallnut"
                  selected={appearance.palette === 'wallnut'}
                  onPress={() => updateAppearance('appearance', { palette: 'wallnut' })}
                />
                <Chip
                  label="Material (tonal)"
                  selected={appearance.palette === 'material'}
                  onPress={() => updateAppearance('appearance', { palette: 'material' })}
                />
              </Row>
              <AppText variant="caption" tone="muted">
                Wallnut is the hand-tuned default. Material derives tonal surfaces and accents from a seed colour, the way
                Material You does.
              </AppText>

              {appearance.palette === 'material' ? (
                <View style={{ borderRadius: theme.radius.md, backgroundColor: theme.colors.inputBackground, overflow: 'hidden' }}>
                  <SettingSwitch
                    title="Use device colours"
                    subtitle={devicePalette?.detail ?? 'Checking device support…'}
                    value={appearance.deviceColors}
                    onValueChange={(value) => {
                      if (value && devicePalette && !devicePalette.available) {
                        toast.show(devicePalette.detail);
                      }
                      updateAppearance('appearance', { deviceColors: value });
                    }}
                  />
                </View>
              ) : null}
              {appearance.palette === 'material' && !appearance.deviceColors ? (
                <AppText variant="caption" tone="muted">
                  Without device colours the palette is derived from your {appearance.accent} accent.
                </AppText>
              ) : null}
            </View>
          </ListGroup>

          <ListGroup title="Typeface">
            <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
              <Row gap="sm" wrap>
                {FONT_OPTIONS.map((option) => {
                  const selected = (appearance.fontFamily ?? 'inter') === option.id;
                  return (
                    <Pressable
                      key={option.id}
                      onPress={() => {
                        updateAppearance('appearance', { fontFamily: option.id });
                        toast.show(`${option.label} typeface`);
                      }}
                      android_ripple={{ color: theme.colors.ripple }}
                      style={{
                        paddingHorizontal: theme.spacing.md,
                        paddingVertical: theme.spacing.sm,
                        borderRadius: theme.radius.lg,
                        borderWidth: StyleSheet.hairlineWidth * 2,
                        borderColor: selected ? theme.colors.accent.base : theme.colors.border,
                        backgroundColor: selected ? theme.colors.accent.soft : theme.colors.inputBackground,
                      }}>
                      <AppText
                        style={{
                          fontFamily: fontsLoaded[option.id] ? option.families.semibold : undefined,
                          fontSize: 15,
                          color: selected ? theme.colors.accent.base : theme.colors.text,
                        }}>
                        {option.label}
                      </AppText>
                    </Pressable>
                  );
                })}
              </Row>
              <Card style={{ backgroundColor: theme.colors.inputBackground }}>
                <AppText variant="caption" tone="muted" style={{ marginBottom: 6 }}>
                  Preview · {fontOption(appearance.fontFamily).label}
                </AppText>
                <AppText variant="numericMedium">₹1,24,500.00</AppText>
                <AppText variant="bodySmall" tone="secondary" style={{ marginTop: 4 }}>
                  Swiggy · Food &amp; Dining · Kotak Credit Card
                </AppText>
              </Card>
              <AppText variant="caption" tone="muted">
                {fontOption(appearance.fontFamily).note}. Each family ships four weights and is stored on-device.
              </AppText>
            </View>
          </ListGroup>

          <ListGroup title="Charts">
            <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
              <Row gap="sm">
                <Chip
                  label="Follow theme"
                  selected={appearance.chartColors === 'theme'}
                  onPress={() => updateAppearance('appearance', { chartColors: 'theme' })}
                />
                <Chip
                  label="Category colours"
                  selected={appearance.chartColors === 'category'}
                  onPress={() => updateAppearance('appearance', { chartColors: 'category' })}
                />
              </Row>
              <AppText variant="caption" tone="muted">
                {appearance.chartColors === 'theme'
                  ? 'Charts use the palette above, so changing the accent instantly restyles every graph.'
                  : 'Charts keep each category’s own colour so you can recognise them at a glance.'}
              </AppText>
            </View>
          </ListGroup>

          <ListGroup title="Preview">
            <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
              <Card style={{ backgroundColor: theme.colors.inputBackground }}>
                <Row justify="space-between" style={{ marginBottom: theme.spacing.sm }}>
                  <AppText variant="bodySmall" tone="secondary">
                    Income
                  </AppText>
                  <MoneyText amount={35_000_00} variant="numericBody" tone="positive" />
                </Row>
                <Row justify="space-between" style={{ marginBottom: theme.spacing.sm }}>
                  <AppText variant="bodySmall" tone="secondary">
                    Expense
                  </AppText>
                  <MoneyText amount={-1_820_50} variant="numericBody" tone="negative" />
                </Row>
                <Row justify="space-between">
                  <AppText variant="bodySmall" tone="secondary">
                    Transfer
                  </AppText>
                  <MoneyText amount={-2_000_00} variant="numericBody" tone="neutral" />
                </Row>
                <Row gap="sm" style={{ marginTop: theme.spacing.lg }}>
                  <Chip label="Selected" selected />
                  <Chip label="Default" />
                </Row>
              </Card>
            </View>
          </ListGroup>

          <ListGroup title="Accessibility">
            <View style={{ gap: 0, borderRadius: theme.radius.lg, overflow: 'hidden' }}>
              <SettingSwitch
                title="Reduce motion"
                subtitle="Disables chart reveals and count-up animations"
                value={appearance.reduceMotion}
                onValueChange={(value) => updateAppearance('appearance', { reduceMotion: value })}
              />
            </View>
            <View style={{ padding: theme.spacing.lg, paddingTop: 0 }}>
              <AppText variant="captionMedium" tone="secondary" style={{ marginBottom: theme.spacing.sm }}>
                Text size
              </AppText>
              <Row gap="sm">
                {(['default', 'large', 'xlarge'] as const).map((scale) => (
                  <Chip
                    key={scale}
                    label={scale === 'default' ? 'Default' : scale === 'large' ? 'Large' : 'Extra large'}
                    selected={appearance.fontScale === scale}
                    onPress={() => updateAppearance('appearance', { fontScale: scale })}
                  />
                ))}
              </Row>
            </View>
          </ListGroup>

          <AppText variant="caption" tone="muted" style={{ paddingHorizontal: theme.spacing.xs }}>
            Wallnut ships a hand-tuned dark and light palette. Dark leans on surface contrast and hairline borders; light uses an
            off-white canvas so cards read as material, not paper.
          </AppText>
        </View>
    </ScrollScreen>
  );
}

function Header({ title }: { title: string }) {
  const theme = useTheme();
  return (
    <Row gap="sm" style={{ paddingTop: theme.spacing.md, paddingBottom: theme.spacing.lg }}>
      <Pressable onPress={() => router.back()} hitSlop={10} android_ripple={{ color: theme.colors.ripple, borderless: true }}>
        <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
      </Pressable>
      <AppText variant="title">{title}</AppText>
    </Row>
  );
}
