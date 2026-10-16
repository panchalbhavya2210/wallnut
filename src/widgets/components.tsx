'use no memo';
import React from 'react';
import { FlexWidget, TextWidget } from 'react-native-android-widget';
import { format, parseISO } from 'date-fns';

import { accents, darkColors, lightColors, type AccentName } from '@/theme/colors';

import type { WidgetSnapshot } from './snapshot';
import type { ColorProp } from 'react-native-android-widget';

/**
 * Android widget renderers.
 *
 * The library screenshots these into a RemoteViews image, so they use ONLY the
 * `FlexWidget`/`TextWidget` primitives (no hooks, no async, no RN views) and
 * follow the Wallnut design tokens: Inter, hairline borders, quiet surfaces and
 * the active accent. Every amount is pre-formatted by WidgetDataService.
 */

export type WidgetThemeMode = 'light' | 'dark';

const FONT_REGULAR = 'Inter_400Regular';
const FONT_SEMIBOLD = 'Inter_600SemiBold';

export const WIDGET_DEEP_LINKS = {
  home: 'wallnut://home',
  quickEntry: 'wallnut://quick-entry',
  quickEntryExpense: 'wallnut://quick-entry?type=expense',
  quickEntryIncome: 'wallnut://quick-entry?type=income',
  quickEntryTransfer: 'wallnut://quick-entry?type=transfer',
  calendar: 'wallnut://calendar',
  settings: 'wallnut://settings/widgets',
} as const;

interface WidgetTokens {
  background: ColorProp;
  text: ColorProp;
  muted: ColorProp;
  border: ColorProp;
  positive: ColorProp;
  negative: ColorProp;
  accent: ColorProp;
  accentSoft: ColorProp;
  neutralSoft: ColorProp;
  onAccent: ColorProp;
}

function tokensFor(accentName: string, mode: WidgetThemeMode): WidgetTokens {
  const base = mode === 'dark' ? darkColors : lightColors;
  const name = (Object.keys(accents) as AccentName[]).includes(accentName as AccentName)
    ? (accentName as AccentName)
    : 'magenta';
  const accent = mode === 'dark' ? accents[name].dark : accents[name].light;
  return {
    background: base.surface as ColorProp,
    text: base.text as ColorProp,
    muted: base.muted as ColorProp,
    border: base.border as ColorProp,
    positive: base.positive as ColorProp,
    negative: base.negative as ColorProp,
    accent: accent.base as ColorProp,
    accentSoft: accent.soft as ColorProp,
    neutralSoft: base.neutralSoft as ColorProp,
    onAccent: accent.on as ColorProp,
  };
}

function widgetTheme(snapshot: WidgetSnapshot, mode: WidgetThemeMode): WidgetTokens {
  return tokensFor(snapshot.accent, mode);
}

/** Primary amounts collapse to a single honest call to action when masked. */
function primary(snapshot: WidgetSnapshot, formatted: string): string {
  return snapshot.showAmounts ? formatted : 'Open Wallnut';
}

/** Secondary amounts simply mask. */
function secondary(snapshot: WidgetSnapshot, formatted: string): string {
  return snapshot.showAmounts ? formatted : '••••';
}

function shortDate(iso: string): string {
  try {
    return format(parseISO(iso), 'd MMM');
  } catch {
    return iso;
  }
}

/* ------------------------------- Shared bits ------------------------------- */

function Header({ tokens }: { tokens: WidgetTokens }) {
  return (
    <FlexWidget
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: 'match_parent',
      }}>
      <TextWidget
        text="WALLNUT"
        style={{ fontSize: 10, letterSpacing: 2, fontFamily: FONT_SEMIBOLD, color: tokens.muted }}
      />
      <FlexWidget style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: tokens.accent }} />
    </FlexWidget>
  );
}

function Root({
  tokens,
  uri,
  children,
  padding = 16,
}: {
  tokens: WidgetTokens;
  uri: string;
  children: React.ReactNode;
  padding?: number;
}) {
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri }}
      style={{
        height: 'match_parent',
        width: 'match_parent',
        flexDirection: 'column',
        justifyContent: 'space-between',
        backgroundColor: tokens.background,
        borderRadius: 24,
        padding,
        borderWidth: tokens.border ? 1 : 0,
        borderColor: tokens.border,
      }}
      accessibilityLabel="Wallnut widget">
      {children}
    </FlexWidget>
  );
}

/** Rendered when the user turned widgets off, or when data cannot be read. */
export function WallnutFallbackWidget({ mode, message }: { mode: WidgetThemeMode; message: string }) {
  const tokens = tokensFor('magenta', mode);
  return (
    <Root tokens={tokens} uri={WIDGET_DEEP_LINKS.home} padding={18}>
      <Header tokens={tokens} />
      <FlexWidget style={{ flexDirection: 'column', flexGap: 4, alignItems: 'flex-start' }}>
        <TextWidget text={message} style={{ fontSize: 14, fontFamily: FONT_SEMIBOLD, color: tokens.text }} maxLines={2} />
        <TextWidget
          text="Open Wallnut"
          style={{ fontSize: 12, fontFamily: FONT_REGULAR, color: tokens.accent }}
        />
      </FlexWidget>
    </Root>
  );
}

/* ----------------------------- 1. Snapshot (2x2) ---------------------------- */

export function WallnutSnapshotWidget({ snapshot, theme }: { snapshot: WidgetSnapshot; theme: WidgetThemeMode }) {
  const tokens = widgetTheme(snapshot, theme);
  if (!snapshot.enabled) {
    return <WallnutFallbackWidget mode={theme} message="Widgets are off in Wallnut settings" />;
  }
  return (
    <Root tokens={tokens} uri={WIDGET_DEEP_LINKS.home}>
      <Header tokens={tokens} />
      <FlexWidget style={{ flexDirection: 'column', flexGap: 1 }}>
        <TextWidget
          text="Safe to spend"
          style={{ fontSize: 11, fontFamily: FONT_REGULAR, color: tokens.muted }}
        />
        <TextWidget
          text={primary(snapshot, snapshot.formatted.safeToSpend)}
          style={{ fontSize: 24, fontFamily: FONT_SEMIBOLD, color: tokens.text }}
          maxLines={1}
          truncate="END"
        />
        {snapshot.showAmounts ? (
          <TextWidget
            text={`${snapshot.formatted.safePerDay} / day`}
            style={{ fontSize: 11, fontFamily: FONT_REGULAR, color: tokens.muted }}
          />
        ) : null}
      </FlexWidget>
      <FlexWidget
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: 'match_parent',
        }}>
        <TextWidget text="Today" style={{ fontSize: 12, fontFamily: FONT_REGULAR, color: tokens.muted }} />
        <TextWidget
          text={secondary(snapshot, snapshot.formatted.todaySpent)}
          style={{ fontSize: 13, fontFamily: FONT_SEMIBOLD, color: snapshot.todaySpent > 0 ? tokens.negative : tokens.text }}
        />
      </FlexWidget>
    </Root>
  );
}

/* ----------------------------- 2. Balance (4x2) ----------------------------- */

export function WallnutBalanceWidget({ snapshot, theme }: { snapshot: WidgetSnapshot; theme: WidgetThemeMode }) {
  const tokens = widgetTheme(snapshot, theme);
  if (!snapshot.enabled) {
    return <WallnutFallbackWidget mode={theme} message="Widgets are off in Wallnut settings" />;
  }
  return (
    <Root tokens={tokens} uri={WIDGET_DEEP_LINKS.home}>
      <Header tokens={tokens} />
      <FlexWidget style={{ flexDirection: 'column', flexGap: 2 }}>
        <TextWidget text="Net worth" style={{ fontSize: 12, fontFamily: FONT_REGULAR, color: tokens.muted }} />
        <TextWidget
          text={primary(snapshot, snapshot.formatted.netWorth)}
          style={{ fontSize: 26, fontFamily: FONT_SEMIBOLD, color: tokens.text }}
          maxLines={1}
          truncate="END"
        />
      </FlexWidget>
      <FlexWidget style={{ flexDirection: 'row', flexGap: 12, width: 'match_parent' }}>
        <FlexWidget style={{ flex: 1, flexDirection: 'column', flexGap: 1 }}>
          <TextWidget text="Available" style={{ fontSize: 11, fontFamily: FONT_REGULAR, color: tokens.muted }} />
          <TextWidget
            text={secondary(snapshot, snapshot.formatted.available)}
            style={{ fontSize: 14, fontFamily: FONT_SEMIBOLD, color: tokens.text }}
          />
        </FlexWidget>
        <FlexWidget style={{ flex: 1, flexDirection: 'column', flexGap: 1 }}>
          <TextWidget text="Safe to spend" style={{ fontSize: 11, fontFamily: FONT_REGULAR, color: tokens.muted }} />
          <TextWidget
            text={secondary(snapshot, snapshot.formatted.safeToSpend)}
            style={{ fontSize: 14, fontFamily: FONT_SEMIBOLD, color: tokens.accent }}
          />
        </FlexWidget>
      </FlexWidget>
    </Root>
  );
}

/* ---------------------------- 3. Quick Add (4x2) ---------------------------- */

function QuickAction({ tokens, label, uri }: { tokens: WidgetTokens; label: string; uri: string }) {
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri }}
      style={{
        flex: 1,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: tokens.accentSoft,
        borderRadius: 14,
      }}
      accessibilityLabel={label}>
      <TextWidget text={label} style={{ fontSize: 12, fontFamily: FONT_SEMIBOLD, color: tokens.accent }} />
    </FlexWidget>
  );
}

export function WallnutQuickAddWidget({ snapshot, theme }: { snapshot: WidgetSnapshot; theme: WidgetThemeMode }) {
  const tokens = widgetTheme(snapshot, theme);
  if (!snapshot.enabled) {
    return <WallnutFallbackWidget mode={theme} message="Widgets are off in Wallnut settings" />;
  }
  return (
    <Root tokens={tokens} uri={WIDGET_DEEP_LINKS.quickEntry}>
      <Header tokens={tokens} />
      <FlexWidget style={{ flexDirection: 'column', flexGap: 6, width: 'match_parent' }}>
        <TextWidget text="Quick add" style={{ fontSize: 12, fontFamily: FONT_REGULAR, color: tokens.muted }} />
        <FlexWidget style={{ flexDirection: 'row', flexGap: 8, width: 'match_parent' }}>
          <QuickAction tokens={tokens} label="Expense" uri={WIDGET_DEEP_LINKS.quickEntryExpense} />
          <QuickAction tokens={tokens} label="Income" uri={WIDGET_DEEP_LINKS.quickEntryIncome} />
          <QuickAction tokens={tokens} label="Transfer" uri={WIDGET_DEEP_LINKS.quickEntryTransfer} />
          <FlexWidget
            clickAction="OPEN_URI"
            clickActionData={{ uri: WIDGET_DEEP_LINKS.quickEntry }}
            style={{
              width: 44,
              height: 44,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: tokens.accent,
              borderRadius: 14,
            }}
            accessibilityLabel="Ask Wallnut">
            <TextWidget text="+" style={{ fontSize: 22, fontFamily: FONT_SEMIBOLD, color: tokens.onAccent }} />
          </FlexWidget>
        </FlexWidget>
      </FlexWidget>
      <TextWidget
        text="Say it: “Spent 450 at Zomato”"
        style={{ fontSize: 11, fontFamily: FONT_REGULAR, color: tokens.muted }}
      />
    </Root>
  );
}

/* ---------------------------- 4. Upcoming (4x2) ----------------------------- */

function UpcomingRow({
  tokens,
  title,
  amount,
  date,
  tone,
}: {
  tokens: WidgetTokens;
  title: string;
  amount: string;
  date: string;
  tone: 'income' | 'expense' | 'transfer';
}) {
  const color = tone === 'income' ? tokens.positive : tone === 'transfer' ? tokens.muted : tokens.negative;
  const sign = tone === 'income' ? '+' : tone === 'transfer' ? '' : '−';
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: WIDGET_DEEP_LINKS.calendar }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: 'match_parent',
        paddingVertical: 2,
      }}>
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', flexGap: 8 }}>
        <TextWidget
          text={title}
          style={{ fontSize: 13, fontFamily: FONT_REGULAR, color: tokens.text }}
          truncate="END"
          maxLines={1}
        />
        <TextWidget text={date} style={{ fontSize: 11, fontFamily: FONT_REGULAR, color: tokens.muted }} />
      </FlexWidget>
      <TextWidget
        text={`${sign}${amount}`}
        style={{ fontSize: 13, fontFamily: FONT_SEMIBOLD, color }}
        maxLines={1}
      />
    </FlexWidget>
  );
}

export function WallnutUpcomingWidget({ snapshot, theme }: { snapshot: WidgetSnapshot; theme: WidgetThemeMode }) {
  const tokens = widgetTheme(snapshot, theme);
  if (!snapshot.enabled) {
    return <WallnutFallbackWidget mode={theme} message="Widgets are off in Wallnut settings" />;
  }
  const items = snapshot.upcoming.slice(0, 3);
  return (
    <Root tokens={tokens} uri={WIDGET_DEEP_LINKS.calendar}>
      <FlexWidget
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: 'match_parent' }}>
        <TextWidget text="Upcoming" style={{ fontSize: 12, fontFamily: FONT_SEMIBOLD, color: tokens.text }} />
        <FlexWidget style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: tokens.accent }} />
      </FlexWidget>
      <FlexWidget style={{ flexDirection: 'column', width: 'match_parent', flexGap: 2 }}>
        {items.length === 0 ? (
          <TextWidget
            text="Nothing scheduled"
            style={{ fontSize: 12, fontFamily: FONT_REGULAR, color: tokens.muted }}
          />
        ) : (
          items.map((item, index) => (
            <UpcomingRow
              key={`${item.title}-${index}`}
              tokens={tokens}
              title={item.title}
              amount={secondary(snapshot, snapshot.formatted.upcoming[index]?.amount ?? '')}
              date={shortDate(item.date)}
              tone={item.type}
            />
          ))
        )}
      </FlexWidget>
      <TextWidget text="Tap to open calendar" style={{ fontSize: 10, fontFamily: FONT_REGULAR, color: tokens.muted }} />
    </Root>
  );
}
