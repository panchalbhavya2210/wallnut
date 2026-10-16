import React, { useId } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { useTheme } from '@/theme/theme';

/**
 * Soft colour blobs behind the top of a screen — the "tinted glass" look from
 * the reference apps. Purely decorative: pointer-events are off, opacity is
 * low enough to keep type contrast, and it costs one small SVG per screen.
 *
 * Three overlapping radial gradients (accent, positive, warning) are drawn
 * once at low opacity instead of a heavy blur, so it stays smooth on Android
 * GPUs without a filter pipeline.
 */
export function GradientBlobs({ style, height = 380 }: { style?: StyleProp<ViewStyle>; height?: number }) {
  const theme = useTheme();
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const dark = theme.mode === 'dark';
  const strong = dark ? 0.3 : 0.22;
  const mid = dark ? 0.22 : 0.15;
  const soft = dark ? 0.16 : 0.11;

  return (
    <View pointerEvents="none" style={[styles.host, { height }, style]}>
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id={`blob-a-${rawId}`} cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor={theme.colors.accent.base} stopOpacity={strong} />
            <Stop offset="1" stopColor={theme.colors.accent.base} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id={`blob-b-${rawId}`} cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor={theme.colors.positive} stopOpacity={mid} />
            <Stop offset="1" stopColor={theme.colors.positive} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id={`blob-c-${rawId}`} cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor={theme.chart.series[2] ?? theme.colors.warning} stopOpacity={soft} />
            <Stop offset="1" stopColor={theme.chart.series[2] ?? theme.colors.warning} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx="14%" cy="34%" r={170} fill={`url(#blob-a-${rawId})`} />
        <Circle cx="92%" cy="6%" r={150} fill={`url(#blob-b-${rawId})`} />
        <Circle cx="62%" cy="88%" r={180} fill={`url(#blob-c-${rawId})`} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    top: -60,
    left: -80,
    right: -80,
    overflow: 'visible',
  },
});
