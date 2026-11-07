import { describe, expect, it } from 'vitest';

import { m3Shape, m3Size, m3Spacing, buildM3Typography, m3Motion } from '@/theme/m3';
import { buildThemeColors } from '@/theme/palette';
import type { FontFamilies } from '@/theme/fonts';

const families: FontFamilies = {
  regular: 'Inter-Regular',
  medium: 'Inter-Medium',
  semibold: 'Inter-SemiBold',
  bold: 'Inter-Bold',
};

describe('Material 3 Expressive tokens', () => {
  it('uses the M3 type scale metrics', () => {
    const type = buildM3Typography(families);
    expect(type.displayLarge.fontSize).toBe(57);
    expect(type.headlineMedium.fontSize).toBe(28);
    expect(type.titleLarge.fontSize).toBe(22);
    expect(type.bodyLarge.fontSize).toBe(16);
    expect(type.labelMedium.fontSize).toBe(12);
    expect(type.labelSmall.fontSize).toBe(11);
  });

  it('exposes the M3 shape, spacing and component sizes', () => {
    expect(m3Shape.extraSmall).toBe(4);
    expect(m3Shape.extraLarge).toBe(28);
    expect(m3Shape.full).toBe(999);
    expect(m3Spacing.space4).toBe(16);
    expect(m3Spacing.space5).toBe(24);
    expect(m3Size.touchTarget).toBe(48);
    expect(m3Size.sheetHandleWidth).toBe(32);
    expect(m3Size.navBar).toBe(64);
  });

  it('ships expressive springs (spatial overshoots, effects do not)', () => {
    expect(m3Motion.expressive.spatial.stiffness).toBeGreaterThan(0);
    expect(m3Motion.expressive.spatial.damping).toBeLessThan(m3Motion.standard.spatial.damping);
    expect(m3Motion.expressive.effects.damping).toBeGreaterThanOrEqual(30);
  });

  it('resolves every M3 color role in both modes', () => {
    for (const mode of ['light', 'dark'] as const) {
      const colors = buildThemeColors({ mode, accent: 'indigo', palette: 'material' });
      for (const role of [
        'primary',
        'onPrimary',
        'primaryContainer',
        'onPrimaryContainer',
        'secondary',
        'secondaryContainer',
        'tertiary',
        'tertiaryContainer',
        'error',
        'errorContainer',
        'surface',
        'onSurface',
        'surfaceVariant',
        'onSurfaceVariant',
        'surfaceContainerLowest',
        'surfaceContainerLow',
        'surfaceContainer',
        'surfaceContainerHigh',
        'surfaceContainerHighest',
        'inverseSurface',
        'inverseOnSurface',
        'inversePrimary',
        'outline',
        'outlineVariant',
        'positive',
        'warning',
      ] as const) {
        expect(colors.m3[role]).toMatch(/^#[0-9A-F]{6}$|^rgba?\(/);
      }
      expect(colors.m3.surface).toBe(colors.background);
      expect(colors.text).toBe(colors.m3.onSurface);
    }
  });

  it('never lets a palette change the meaning of money', () => {
    const material = buildThemeColors({ mode: 'dark', accent: 'indigo', palette: 'material' });
    const classic = buildThemeColors({ mode: 'dark', accent: 'indigo', palette: 'wallnut' });
    expect(material.positive).toBe(classic.positive);
    expect(material.negative).toBe(classic.negative);
    expect(material.warning).toBe(classic.warning);
  });
});
