import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Font from 'expo-font';

import { useTheme } from '@/theme/theme';
import { accents, type AccentName } from '@/theme/colors';
import { FONT_OPTIONS, fontOption } from '@/theme/fonts';
import { Card, ListGroup, Row, ScreenHeader, ScrollScreen } from '@/components/ui/layout';
import { AppText, MoneyText } from '@/components/ui/text';
import { Chip, SettingSwitch } from '@/components/ui/controls';
import { useSettingsStore } from '@/stores/settings.store';
import { toast } from '@/stores/ui.store';
import { getDevicePaletteSeed, type DevicePaletteResult } from '@/services/device-palette/device-palette.service';

/**
 * Appearance — theme, accent, shape, text and motion. Changes apply instantly
 * because the theme is built from this store on every render.
 */
function ColorToken({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, minWidth: 0, gap: 5, alignItems: 'center' }}>
      <View
        style={{
          width: '100%',
          height: 38,
          borderRadius: theme.radius.md,
          backgroundColor: value,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
        }}
      />
      <AppText variant="caption" tone="muted" numberOfLines={1} style={{ fontSize: 10 }}>
        {label}
      </AppText>
    </View>
  );
}

export default function AppearanceSettings() {
  const theme = useTheme();
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
  const themeLabel = appearance.theme === 'system' ? 'System' : appearance.theme === 'dark' ? 'Dark' : 'Light';
  const accentLabel = accents[appearance.accent as AccentName]?.label ?? appearance.accent;
  const boxy = appearance.cornerStyle === 'boxy';

  return (
    <ScrollScreen>
      <ScreenHeader title="Appearance" subtitle={`${themeLabel} · ${accentLabel} · ${boxy ? 'Boxy' : 'Round'} corners`} />

      <View style={{ gap: theme.spacing.lg }}>
        <ListGroup title="Preview">
          <View style={{ padding: theme.spacing.lg }}>
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

        <ListGroup title="Primary colour">
          <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
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
                    accessibilityRole="button"
                    accessibilityLabel={`${accents[name].label} accent`}
                    accessibilityState={{ selected }}
                    android_ripple={{ color: theme.colors.ripple, borderless: true }}
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: theme.radius.full,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
                      borderColor: selected ? tokens.base : theme.colors.border,
                    }}>
                    <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: tokens.base }} />
                  </Pressable>
                );
              })}
            </View>
            <AppText variant="caption" tone="muted">
              {accentLabel} · used for buttons, selected states and charts. Income and expense colours never change.
            </AppText>
          </View>
        </ListGroup>

        <ListGroup title="Semantic colours">
          <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              <ColorToken label="Primary" value={theme.colors.accent.base} />
              <ColorToken label="Success" value={theme.colors.positive} />
              <ColorToken label="Danger" value={theme.colors.negative} />
              <ColorToken label="Warning" value={theme.colors.warning} />
              <ColorToken label="Canvas" value={theme.colors.background} />
            </View>
            <AppText variant="caption" tone="muted">
              Green, red and amber are deliberately fixed: money in, money out and needs attention. That keeps financial meaning
              consistent even when you switch themes, accents or typefaces.
            </AppText>
          </View>
        </ListGroup>

        <ListGroup title="Shape">
          <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
            <Row gap="sm">
              {(['round', 'boxy'] as const).map((option) => {
                const selected = (appearance.cornerStyle ?? 'round') === option;
                return (
                  <Pressable
                    key={option}
                    onPress={() => updateAppearance('appearance', { cornerStyle: option })}
                    android_ripple={{ color: theme.colors.ripple }}
                    accessibilityRole="button"
                    accessibilityLabel={option === 'boxy' ? 'Boxy corners' : 'Round corners'}
                    accessibilityState={{ selected }}
                    style={{
                      flex: 1,
                      alignItems: 'center',
                      gap: theme.spacing.sm,
                      paddingVertical: theme.spacing.lg,
                      borderRadius: theme.radius.md,
                      borderWidth: StyleSheet.hairlineWidth * 2,
                      borderColor: selected ? theme.colors.accent.base : theme.colors.border,
                      backgroundColor: selected ? theme.colors.accent.soft : theme.colors.inputBackground,
                    }}>
                    <View
                      style={{
                        width: 48,
                        height: 34,
                        borderRadius: option === 'boxy' ? 2 : 12,
                        borderWidth: 1.5,
                        borderColor: selected ? theme.colors.accent.base : theme.colors.textSecondary,
                      }}
                    />
                    <AppText variant="bodySmall" tone={selected ? 'accent' : 'secondary'}>
                      {option === 'boxy' ? 'Boxy' : 'Round'}
                    </AppText>
                  </Pressable>
                );
              })}
            </Row>
            <AppText variant="caption" tone="muted">
              Boxy sharpens cards, inputs and sheets. Avatars and status dots stay circular.
            </AppText>
          </View>
        </ListGroup>

        <ListGroup title="Text & motion">
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
            <AppText variant="caption" tone="muted">
              {fontOption(appearance.fontFamily).note} Each family ships four weights and is stored on-device.
            </AppText>

            <AppText variant="captionMedium" tone="secondary">
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

            <View style={{ borderRadius: theme.radius.md, backgroundColor: theme.colors.inputBackground, overflow: 'hidden' }}>
              <SettingSwitch
                title="Reduce motion"
                subtitle="Disables chart reveals and count-up animations"
                value={appearance.reduceMotion}
                onValueChange={(value) => updateAppearance('appearance', { reduceMotion: value })}
              />
            </View>
          </View>
        </ListGroup>

        <ListGroup title="Advanced">
          <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
            <AppText variant="captionMedium" tone="secondary">
              Color system
            </AppText>
            <Row gap="sm">
              <Chip
                label="Material 3 Expressive"
                selected={appearance.palette === 'material'}
                onPress={() => updateAppearance('appearance', { palette: 'material' })}
              />
              <Chip
                label="Wallnut classic"
                selected={appearance.palette === 'wallnut'}
                onPress={() => updateAppearance('appearance', { palette: 'wallnut' })}
              />
            </Row>
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
            <AppText variant="caption" tone="muted">
              {appearance.palette === 'wallnut'
                ? 'Wallnut classic keeps the hand-tuned canvas; components still use M3 roles.'
                : appearance.deviceColors
                  ? 'Tonal surfaces follow your wallpaper.'
                  : `Tonal surfaces derive from the ${accentLabel.toLowerCase()} accent.`}
            </AppText>

            <AppText variant="captionMedium" tone="secondary">
              Motion
            </AppText>
            <Row gap="sm">
              <Chip
                label="Expressive"
                selected={(appearance.motionScheme ?? 'expressive') === 'expressive'}
                onPress={() => updateAppearance('appearance', { motionScheme: 'expressive' })}
              />
              <Chip
                label="Standard"
                selected={appearance.motionScheme === 'standard'}
                onPress={() => updateAppearance('appearance', { motionScheme: 'standard' })}
              />
            </Row>
            <AppText variant="caption" tone="muted">
              {(appearance.motionScheme ?? 'expressive') === 'expressive'
                ? 'Springy, physical motion for key interactions (M3 Expressive).'
                : 'Minimal bounce for a calmer, utilitarian feel.'}
            </AppText>

            <AppText variant="captionMedium" tone="secondary">
              Charts
            </AppText>
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
                ? 'Charts use the accent palette, so changing the accent restyles every graph.'
                : 'Charts keep each category’s own colour so you can recognise them at a glance.'}
            </AppText>
          </View>
        </ListGroup>

        <AppText variant="caption" tone="muted" style={{ paddingHorizontal: theme.spacing.xs }}>
          Wallnut now follows Material 3 Expressive: color roles, the M3 type scale, expressive shapes and spring‑based motion.
          Every screen inherits the tokens from the root provider.
        </AppText>
      </View>
    </ScrollScreen>
  );
}
