import type { FontSource } from 'expo-font';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import {
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
} from '@expo-google-fonts/poppins';
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
} from '@expo-google-fonts/manrope';
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
} from '@expo-google-fonts/dm-sans';
import {
  Sora_400Regular,
  Sora_500Medium,
  Sora_600SemiBold,
  Sora_700Bold,
} from '@expo-google-fonts/sora';
import {
  Outfit_400Regular,
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
} from '@expo-google-fonts/outfit';
import {
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import {
  Lora_400Regular,
  Lora_500Medium,
  Lora_600SemiBold,
  Lora_700Bold,
} from '@expo-google-fonts/lora';

/**
 * Font choices offered in Appearance. Ten families max — each ships four
 * weights, and the active one is loaded on demand (never all at once, so a
 * font switch doesn't pay for the others).
 */

export const DEFAULT_FONT_ID = 'inter';

export interface FontFamilies {
  regular: string;
  medium: string;
  semibold: string;
  bold: string;
}

export interface FontOption {
  id: string;
  label: string;
  /** Short description shown under the picker. */
  note: string;
  /** The RN fontFamily names once loaded. */
  families: FontFamilies;
  /** Modules passed to useFonts/Font.loadAsync. */
  modules: Record<string, FontSource>;
}

export const FONT_OPTIONS: FontOption[] = [
  {
    id: 'inter',
    label: 'Inter',
    note: 'The Wallnut default — crisp and neutral',
    families: { regular: 'Inter_400Regular', medium: 'Inter_500Medium', semibold: 'Inter_600SemiBold', bold: 'Inter_700Bold' },
    modules: { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold },
  },
  {
    id: 'poppins',
    label: 'Poppins',
    note: 'Geometric and friendly',
    families: { regular: 'Poppins_400Regular', medium: 'Poppins_500Medium', semibold: 'Poppins_600SemiBold', bold: 'Poppins_700Bold' },
    modules: { Poppins_400Regular, Poppins_500Medium, Poppins_600SemiBold, Poppins_700Bold },
  },
  {
    id: 'manrope',
    label: 'Manrope',
    note: 'Modern financial dashboard',
    families: { regular: 'Manrope_400Regular', medium: 'Manrope_500Medium', semibold: 'Manrope_600SemiBold', bold: 'Manrope_700Bold' },
    modules: { Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold },
  },
  {
    id: 'dm-sans',
    label: 'DM Sans',
    note: 'Clean and compact',
    families: { regular: 'DMSans_400Regular', medium: 'DMSans_500Medium', semibold: 'DMSans_600SemiBold', bold: 'DMSans_700Bold' },
    modules: { DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold },
  },
  {
    id: 'sora',
    label: 'Sora',
    note: 'Technical and precise',
    families: { regular: 'Sora_400Regular', medium: 'Sora_500Medium', semibold: 'Sora_600SemiBold', bold: 'Sora_700Bold' },
    modules: { Sora_400Regular, Sora_500Medium, Sora_600SemiBold, Sora_700Bold },
  },
  {
    id: 'outfit',
    label: 'Outfit',
    note: 'Rounded and warm',
    families: { regular: 'Outfit_400Regular', medium: 'Outfit_500Medium', semibold: 'Outfit_600SemiBold', bold: 'Outfit_700Bold' },
    modules: { Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold, Outfit_700Bold },
  },
  {
    id: 'space-grotesk',
    label: 'Space Grotesk',
    note: 'Distinctive, slightly techy',
    families: { regular: 'SpaceGrotesk_400Regular', medium: 'SpaceGrotesk_500Medium', semibold: 'SpaceGrotesk_600SemiBold', bold: 'SpaceGrotesk_700Bold' },
    modules: { SpaceGrotesk_400Regular, SpaceGrotesk_500Medium, SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold },
  },
  {
    id: 'lora',
    label: 'Lora',
    note: 'A warm serif for a classic ledger feel',
    families: { regular: 'Lora_400Regular', medium: 'Lora_500Medium', semibold: 'Lora_600SemiBold', bold: 'Lora_700Bold' },
    modules: { Lora_400Regular, Lora_500Medium, Lora_600SemiBold, Lora_700Bold },
  },
];

export function fontOption(id: string | undefined | null): FontOption {
  return FONT_OPTIONS.find((option) => option.id === id) ?? FONT_OPTIONS[0]!;
}

export function fontFamiliesFor(id: string | undefined | null): FontFamilies {
  return fontOption(id).families;
}

export function fontModulesFor(id: string | undefined | null): Record<string, FontSource> {
  return fontOption(id).modules;
}
