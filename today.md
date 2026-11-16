# Today — UI consistency & navigation repair (2026-11-16)

> Handoff log for this session. Read this before continuing. Each item lists the
> user complaint, the root cause found in the code, the fix, and how to verify.
> `TASKS.md` remains the long-term architecture/history document.

## User complaints (verbatim intent)

1. Drawer toggle has been broken for ~5 commits.
   - Closed with the X button → it reopens.
   - Closed through a modal → it stays closed / behaves differently.
2. The UI no longer reads as Material. Charts look like they come from
   different libraries.
3. Insights is messy.
   - Tapping a category should be enough to see the category's spending.
   - The detailed view should open as a next page.
   - The month range must persist into that page.
   - The chart on the detail page must use the same month range.
4. The Home-screen chart was removed without being asked for.
5. Alert boxes jump violently when reduce-motion is off.
6. Enable swipe to change pages.
7. Bottom navigation should only appear where it is needed — not on the
   transaction creation screen.
8. Improve Wallnut AI for expense creation and everywhere else.
9. The notification panel is not being used correctly.
10. Widgets (Android home-screen widgets) feel bad.
11. Keep this today file updated so a fresh agent can continue without research.

## Root causes found

| Complaint | Root cause |
| --- | --- |
| Drawer inconsistent | Two drawer implementations exist: the native `expo-router/drawer` (opened by `HeaderMenuButton`/`BottomNav` inside `(app)`) and the root `GlobalDrawer` overlay (opened everywhere else). Their close paths differ. `HeaderMenuButton` only opens (never toggles), and `drawerOpen` is never reset on route changes. |
| Bottom nav everywhere | `RootBottomNav` renders `BottomNav` for every route except onboarding, even modals/composers/detail screens. |
| Home chart missing | `NetWorthWidget` explicitly dropped the hero trend in Pass 19 (`widgets.tsx` line ~297 comment: "The full trend lives in Insights"). The trend data is already fetched and unused. |
| Alert jumping | `ToastHost` stacks up to 3 toasts in a flex-end container; each enters with `SlideInDown.springify()` while the layout reflows. The spring overshoots and pushes the existing toasts. |
| Insights range lost | `openCategory()` routes to `/category/:id` / `/merchant/:name` / `/transactions?...` with no range params. Both detail screens start at `thisMonth`. |
| Charts feel unrelated | All charts are `react-native-svg`, but Insights hand-rolls its weekday bars and several screens pass `theme.colors.accent.base` while charts default to `theme.chart.series[0]`; there is no shared small-chart/legend API. |
| Notification bell | `HeaderBell` pushes `/review` (the review queue), not a notification panel or the Financial Inbox. |
| Android widgets | `widgets/components.tsx` renders with the legacy `lightColors`/`darkColors` + raw accent, while the app now uses the M3 tonal palette. Widgets therefore do not match the app's colours. |
| No swipe pages | `TopTabs` in Insights is tap-only; there is no pager gesture. |
| AI expense entry | AI category suggestion is manual, hidden when privacy mode is `'none'` (backwards), and the composer has no natural-language fill. |

## Motion UI & library upgrade plan (requested 2026-11-16)

### Decision in one line

Use **React Native Paper 5.15.x** for standard Material behaviour, **Reanimated
4.5.x** (already installed) for all motion, and **react-native-gifted-charts
1.4.x** behind our existing chart API. Keep our M3 token system, bottom-sheet
engine and expressive surfaces. Do **not** add Moti, Skia/Victory Native, chart-
kit, NativeWind/Tamagui/Unistyles in this pass.

This gives a real Material component layer without destabilising Expo SDK 57 or
the existing Android build, and it remains one chart language instead of four.

### Why these libraries (checked November 2026)

| Library | Version | Verdict | Reason |
| --- | --- | --- | --- |
| `react-native-paper` | **5.15.4** (latest stable, published 2026-11-02) | **Adopt** | MD3/Material You component set (buttons, chips, segmented buttons, switch, text fields, searchbar, snackbar, badge, progress, FAB, tooltip) with accessibility/ripple/motion built in. Pure JS + `react-native-safe-area-context`; Expo already ships the icon fonts. A Sep-2026 lab ran Paper 5.15.3 with Expo 57 / RN 0.86.3 / React 19.2.3 / RNW 0.21.3 successfully. **Install through `npx expo install react-native-paper` so the latest stable compatible release is resolved; do not pin an older 5.x.** The 6.0.0-alpha line exists but is not production-safe; upgrade behind the wrapper layer once 6.0.0 is stable. |
| `react-native-gifted-charts` | **1.4.81** (latest) | **Adopt** | Renders with `react-native-svg` + `expo-linear-gradient` (both already installed). Line, area, bar, stacked bar, pie, donut, sparkline-style, combined charts; animations; works on web; no native module, so no rebuild/Expo-doctor risk. Right size for Wallnut's aggregates (tens of points, not thousands). |
| `react-native-reanimated` | **4.5.1** (already) | **Keep / standardise** | UI-thread springs, gestures, layout animations and the new CSS-style transitions. This is the "motion UI" layer. No extra package needed. |
| `moti` | 0.30.0 (Jan 2025) | **Reject** | Stale for two years and now redundant: Reanimated 4 CSS transitions + entering/exiting/layout cover the same declarative cases with one less dependency. |
| `victory-native` XL | 43.0.1 | **Defer** | Excellent for gesture-heavy, thousands-of-point charts, but v43 requires Skia **≥ 2.15.1**; Expo SDK 57 pins **Skia 2.6.2**, and that build has a known Android clipping bug on RN 0.86 (expo/expo#50733). Overriding Expo's native pin is not worth the instability. Revisit after Expo SDK 58. |
| `react-native-chart-kit` | old | **Reject** | Slow-moving, limited styling, no animations worth keeping. |
| `react-native-charts-wrapper` | native MPAndroidChart/Charts | **Reject** | Imperative native views; impossible to match our M3 tokens and scrub gestures cleanly. |
| `lottie-react-native` | 7.5.1 | **Optional, later** | Only if we commission real success/empty-state art. Not a foundation. |
| `@expo/ui` Compose/SwiftUI | bundled | **Keep for device palette only** | Android/iOS native, but the web preview is part of the dev loop; cannot be the primary component layer. |
| `react-native-unistyles` / NativeWind / Tamagui / gluestack | n/a | **Reject for now** | Styling/engine rewrites, none of them Material. They would replace the design system rather than fix it. |

### Non-negotiable constraints

1. **One chart language.** Every chart-like visual (line, area, bar, donut,
   sparkline, weekday bars, rank bars) goes through `src/components/charts.tsx`.
   No screen may import a chart library directly.
2. **One motion language.** Durations/springs only from `theme.m3.motion` and
   `theme.motion`. Every animation checks `reduceMotion`. No RN `Animated` for
   app chrome after Phase 1 (Reanimated only).
3. **One Material behaviour layer.** Paper components are wrapped in
   `src/components/ui/*`; screens keep importing our wrappers, never Paper
   directly (except type-only imports). Swapping Paper out later remains possible.
4. **No native `Modal`.** The `@gorhom/bottom-sheet` engine stays (Pass 26).
   Paper `Dialog/Portal` may be used only inside a sheet, never as a second
   native window.
5. **Bottom nav only on primary destinations** (`/`, `/transactions`,
   `/budgets`, `/analytics`). Never on composer, quick-entry, import, onboarding,
   AI, or pushed detail screens.
6. **No forced visual rewrite of every screen at once.** Wrappers change
   internals first; screens migrate screen-by-screen as they are touched.
7. **Performance is a gate, not a vibe.** Each phase ships only if the checks in
   the Performance section pass.

### Exact installs

```bash
npx expo install react-native-paper
npx expo install react-native-gifted-charts expo-linear-gradient react-native-svg
# Already installed, listed so nobody reinstalls a different major:
# react-native-reanimated 4.5.1, react-native-worklets, react-native-gesture-handler
```

No `babel.config.js` changes: Expo SDK 57 already applies the Reanimated/worklets
plugin through `babel-preset-expo`, and `react-native-paper/babel` is only a
bundle-size optimisation that is incompatible with the app's need to keep
Metro untouched (see TASKS.md §5). Paper is pure JS; the optional plugin is not
required.

### Architecture

```
src/theme/
  m3.ts                 today: color/shape/type/motion tokens (unchanged)
  paper.ts              NEW: MD3LightTheme/MD3DarkTheme -> our M3 roles,
                        roundness from cornerStyle, fontConfig from our fonts
src/components/ui/
  paper.tsx             NEW: PaperProvider + icon adapter + re-exports
  motion.tsx            NEW: FadeInView, SlideInView, PressScale, Stagger,
                        AnimatedCounter, AnimatedProgress, useMotionPreset
  controls.tsx          keep public API; internals move to Paper where it wins
  feedback.tsx          ToastHost -> Paper Snackbar queue (single toast)
  layout.tsx            Card/Screen stay custom; add Paper Surface where useful
src/components/charts.tsx
                        keep public API (LineChart, BarChart, DonutChart,
                        Sparkline, FlowBars); internals move to Gifted Charts
  + MiniLineChart, BarList, ChartLegend, ChartFrame
```

### Motion spec

| Interaction | Motion |
| --- | --- |
| Screen push/pop | native-stack `slide_from_right` 220 ms (already), fade for shell |
| Card/list entrance | `FadeInUp` 180–220 ms, 12 dp travel, stagger 30 ms, max 8 items |
| Bottom sheet | gorhom native spring (keep) |
| Toast/snackbar | fade + 16 dp slide, **no spring overshoot**, 180 ms; one at a time |
| Tab/page change | shared axis: outgoing fade/8 dp left, incoming fade/8 dp right, 180 ms |
| Button press | scale 0.97 on press, spring back (`effects` spring), no overshoot on release |
| Value change | 400 ms count-up only for hero numbers; skip when reduceMotion |
| Chart reveal | 300–420 ms opacity/clip reveal; no per-point bounce |
| Drawer | translateX spring/timing 220 ms, scrim fade in parallel |

Rules: never animate `height`/`width` on the JS thread; prefer transform/opacity.
All presets read `theme.motion.reduceMotion` and collapse to 0 ms.

### Chart spec (Gifted Charts under our API)

- **Line / area:** `LineChart` keeps `points`, `comparison`, `baseline`,
  `showAverage`, `onPointPress`, `onDark`. Theme: `theme.chart.series[0/1]`,
  `outlineVariant` grid, `onSurfaceVariant` labels. Disable library animations
  when reduceMotion. Downsample > 120 points to weekly/monthly before render.
- **Bar:** same public contract; rounded 4–6 dp caps, gradient fill from primary;
  no y-axis line, no x-axis line, faint dashed rules.
- **Donut:** `PieChart donut` with 2–3 dp gaps, rounded caps, centre label;
  fall back to our SVG donut if Gifted's label layout fights the M3 type scale.
- **Sparkline / mini hero chart:** `MiniLineChart` (new, no axes, no labels,
  gradient area) for the Home hero and stat tiles.
- **BarList:** shared horizontal share bars (categories, merchants, accounts).
- **Weekday bars:** replace the hand-rolled `WeekdayBars` with `BarChart`
  (`compactLabels`) so every bar in the app shares geometry and tokens.
- **Legend:** one `ChartLegend` component, dot or dashed line variants.
- **Accessibility:** every chart gets a concise `accessibilityLabel`; tooltip
  values remain visible (not hover-only).

### Chart settings (requested 2026-11-16)

Chart configuration becomes a first-class Settings page, not a hidden pair of
chips inside Appearance. The settings are persisted in a new `charts` settings
group and read by `src/components/charts.tsx` by default; explicit props on a
chart still win.

```ts
interface ChartsSettings {
  /** Default time-series mark. */
  trendStyle: 'line' | 'area' | 'bar';
  /** Palette source: accent-derived series or each category's own colour. */
  colorSource: 'theme' | 'category';
  /** Horizontal guide lines. */
  showGrid: boolean;
  /** Dashed average line where a trend has a meaningful average. */
  showAverage: boolean;
  /** Dots on line points. */
  showMarkers: boolean;
  /** Tap/scrub value tooltip. */
  showTooltips: boolean;
  /** Reveal animation (also respects reduceMotion). */
  animate: boolean;
  /** Donut or pie for category breakdowns. */
  breakdownStyle: 'donut' | 'pie';
  /** Total in the centre of a donut. */
  showCentreTotal: boolean;
  /** Point budget before the chart aggregates (60 / 120 / 240). */
  maxPoints: 60 | 120 | 240;
}
```

**Files**
| File | Work |
| --- | --- |
| `src/services/settings.service.ts` | Add `ChartsSettings`, add it to `SettingsGroups`/`DEFAULT_SETTINGS`; migrate the legacy `appearance.chartColors` value into `charts.colorSource` once. |
| `src/app/settings/charts.tsx` | New page: live preview (line/area/bars + donut), style chips, colour source, switches (grid/average/markers/tooltips/animate/centre total), point-budget chips, reset. |
| `src/app/settings/index.tsx` | Add "Charts" row (subtitle shows style + colour source) under Personalise. |
| `src/hooks/useChartSettings.ts` | Merge persisted defaults with per-chart prop overrides; expose `chartOptions` for components. |
| `src/components/charts.tsx` | Every chart reads the hook; honours grid/markers/tooltips/animation/point budget; adds `MiniLineChart`, `BarList`, `ChartLegend`, `ChartFrame`. |
| `src/app/settings/dashboard.tsx` | Per-widget configure sheet gains chart type / average / grid / compact labels for every chart-capable widget (`spending_trend`, `net_worth_trend`, `category_monthly`, `income_expense`). |
| `src/hooks/useChartColors.ts` | Source becomes `charts.colorSource` with the legacy `appearance.chartColors` fallback for one migration. |

**Defaults** (match current visual language): `trendStyle: 'area'`,
`colorSource: 'theme'`, `showGrid: true`, `showAverage: false`,
`showMarkers: true`, `showTooltips: true`, `animate: true`,
`breakdownStyle: 'donut'`, `showCentreTotal: true`, `maxPoints: 120`.

**UX rules**
- Changes preview immediately in the settings page (one small line + one donut).
- Reset restores the defaults in one tap with a confirmation toast.
- Reduce-motion overrides `animate` (no reveal, no count-up).
- The chart settings page never overrides an explicit per-widget choice; the
  per-widget sheet labels its overrides "Widget override" and offers "Use global".

### Phased execution (each phase shippable on its own)

**Phase 0 — baseline (½ day)**
- Capture current `home`, `insights`, `category`, `composer`, `quick-entry`,
  `drawer` screenshots at 390×844 and dark/light.
- Record web export size, boot time, JS frame drops while scrolling Home.
- Freeze new bespoke control/chart code; every new visual must use a shared
  primitive from this plan.

**Phase 1 — motion foundation (1–2 days)**
- Add `ui/motion.tsx`; replace RN `Animated` in `GlobalDrawer` and `ToastHost`.
- Fix the toast jump: one toast at a time, no spring overshoot, transform-only
  countdown bar.
- Add stagger to Insights cards and list rows; keep `React.memo` boundaries.
- Verify reduceMotion (every animation becomes instant) and 60 fps drawer open.

**Phase 2 — Paper foundation + chart settings (3–4 days)**
- Add `PaperProvider` inside `ThemeProvider` (root `_layout.tsx`).
- Map M3 roles → Paper `MD3LightTheme/MD3DarkTheme`; `roundness` from
  `cornerStyle`; `fontConfig` from the active font family.
- Migrate wrapper internals in this order: Snackbar (toasts), Badge, Tooltip,
  ProgressBar, Switch, SegmentedButtons, Chip, Button/IconButton, TextInput,
  Searchbar. Keep `Card`, `AppHeader`, `BottomNav`, `BottomSheet` custom.
- Add the `charts` settings group, `useChartSettings`, and
  `Settings → Charts` (live preview + all options in the section above).
- Remove the duplicate chart chips from Appearance once the new page ships.
- Screens do not change in this phase. Re-run `verify-m3.mjs` +
  `verify-modals.mjs`; the only visible difference should be correct Material
  ripple/state/typography plus the new Charts page.

**Phase 3 — charts (3–4 days)**
- Add `react-native-gifted-charts`; rewrite `charts.tsx` internals behind the
  existing exports. Add `MiniLineChart`, `BarList`, `ChartLegend`, `ChartFrame`.
- Wire every chart to `useChartSettings` (grid, average, markers, tooltips,
  animation, point budget, donut/pie, centre total).
- Migrate Insights Overview/Trends/Categories, category detail, merchant detail,
  reports, Home widgets, budgets/goals gauges to the shared API.
- Add per-widget chart options to the dashboard configure sheet.
- Delete the hand-rolled weekday bars and any ad-hoc `View` bar charts.
- Perf: memoised data transforms, max 120 points by default, no chart inside a
  virtualised row, reduceMotion disables reveal.

**Phase 4 — navigation, drawer, swipe (2 days)**
- One drawer only: `GlobalDrawer` for every screen; disable the native drawer's
  edge swipe; header button toggles; add close X; reset state on route change;
  back closes the overlay.
- Disable bottom nav + FAB outside the four primary routes; add 24/72 dp
  clearance only where the nav actually renders.
- Add `SwipePager` for the Insights tabs (4 pages) using a parent Pan with
  `activeOffsetX ±32`, `failOffsetY ±12`; a child chart pan activates first and
  keeps scrub priority. Add animated underline/tab indicator.

**Phase 5 — screen fixes (3–4 days)**
- Insights: persist the selected range into category/merchant/transactions
  detail (`?period=…&from=…&to=…`); detail defaults to the incoming range.
- Category/merchant detail: custom range chip + exact same chart period.
- Home: restore the hero trend chart (`MiniLineChart`) in `NetWorthWidget`.
- Notification panel: bell opens a real notification sheet (inbox items,
  upcoming, review, daily check-in, settings), not `/review`.
- AI expense creation: inline "describe it" fill in the composer; fix the
  backwards privacy gate; auto-suggest category once merchant+amount exist.
- Android widgets: render from the M3 tonal palette, not legacy colours.

**Phase 6 — consistency audit & performance (2 days)**
- Grep for raw hex, `StyleSheet.create` shadows, uppercase `label` captions,
  raw RN `Switch`, direct chart imports, RN `Animated` in screens; replace.
- Audit every screen at 320/390/430 dp, light/dark, font scale 1.16, reduceMotion.
- Virtualise long lists, memo chart data, keep `useQuery` stale-while-revalidate,
  no per-row gesture recreation.
- Performance budgets below; fix anything over budget before declaring done.

**Phase 7 — verification & release (1–2 days)**
- `npm run typecheck`, `npm test`, `npx expo lint` on touched files.
- Extend `verify-m3.mjs` for Paper controls + drawer toggle; add
  `verify-pager.mjs` (swipe tabs), `verify-insights-range.mjs`.
- Rebuild web export + screenshots; EAS APK for Android widget/back-button pass.

### Performance budgets (hard gates)

| Metric | Budget |
| --- | --- |
| Cold boot to Home (web, 390×844) | ≤ 1.8 s (today ~1.4 s) |
| Drawer open start → interactive | ≤ 250 ms; zero SQL during the slide |
| Insights tab switch (tap or swipe) | ≤ 100 ms to first paint, no spinner for cached data |
| Chart scrub | no dropped frames > 1 per gesture; scroll stays locked |
| Home scroll | 60 fps target, no widget re-render from the minute clock |
| Memory | no new native modules in this pass; Paper/Gifted are JS-only |
| Bundle | report size before/after; size increase is accepted if boot/scroll stay in budget |

Measurement: `[boot]` logs already exist; add temporary `performance.mark`
around drawer open, tab switch and chart mount in `__DEV__`; verify with
`scripts/verify-web.mjs` + Chrome performance profile. No new monitoring service.

### Risks & rollbacks

| Risk | Mitigation / rollback |
| --- | --- |
| Paper's theme/roundness fights our M3 tokens | `paper.ts` is a pure adapter; wrappers can revert to the old implementation in one file. Phase 2 is behind wrapper internals, screens untouched. |
| Paper + RNW 0.21 on web behaves differently | Verify every migrated wrapper in `verify-web.mjs`; keep the old control code in git history; migrate one control per commit. |
| Gifted Charts renders different SVG geometry on web | Keep our public chart API; if a chart type misbehaves, keep the custom SVG implementation for that type only. One chart type per commit. |
| Swipe pager steals chart scrubbing | Child chart gestures activate at ±8 px, pager at ±32 px with vertical fail; test on device. If still fragile, limit pager to non-chart tab bodies. |
| Expo SDK 57 native pin conflicts | No new native modules in this plan. Skia/Victory is explicitly deferred to SDK 58. |
| Bundle/startup regression | `react-native-paper/babel` optional later; tree-shaking via named imports; measure boot each phase. |

### Deliberately not doing (and why)

- **Skia / Victory Native now** — incompatible native pin (see table).
- **Moti** — stale, redundant with Reanimated 4.
- **A second UI kit (Tamagui/gluestack/NativeWind)** — replaces the token
  system and forces a full-screen rewrite; Paper is the Material-specific fix.
- **React Native Paper's Portal/Dialog for app dialogs** — would undo Pass 26's
  single-sheet engine and Android reliability.
- **Full-screen Storybook** — useful later for component review, but it adds
  native/CI weight; screenshots + verify scripts cover this app today.

### Definition of done for the whole upgrade

1. Every control and chart on Home, Insights, Transactions, Budgets, category
   detail, merchant detail and composer comes from the shared wrapper layer.
2. One drawer implementation; open/close/toggle/back/route-change all agree.
3. Bottom nav appears only on the four primary destinations.
4. Swiping Insights changes tabs; charts still scrub.
5. Alerts never jump; reduceMotion removes all non-essential motion.
6. Detail pages inherit the Insights range and all charts use it.
7. Home hero trend chart is back.
8. Bell opens a real notification panel.
9. AI can fill an expense from a sentence in the composer.
10. Android widgets use the same tonal palette as the app.
11. All gates in TASKS.md §2 plus the new verify scripts pass.

---

## Work log

### Pass A — navigation & drawer (landed)

- **One drawer implementation.** `HeaderMenuButton` and the bottom-nav "More"
  now always open the root `GlobalDrawer` overlay; the native drawer's edge
  swipe is disabled. The overlay has an explicit **X**, closes on backdrop/back,
  and resets `drawerOpen` on every route change. This removes the dual
  open/close state machine behind "closed it with X and it reopened".
- **Bottom nav scoped.** `src/utils/routes.ts` owns `isPrimaryRoute` /
  `isImmersiveRoute`; `RootBottomNav` renders only on `/`, `/transactions`,
  `/budgets`, `/analytics`. Settings, charts, composer, quick-entry, import and
  detail screens no longer show it (or the FAB). Toasts use the same predicate
  for their bottom offset.
- **Home chart restored.** `NetWorthWidget` renders `MiniLineChart` again
  (white line on the hero, same selected period). The data was already fetched.
- **Alerts no longer jump.** `ToastHost` shows one snackbar at a time (newest
  wins) and enters with a 160 ms fade instead of a spring; the countdown no
  longer pushes a sibling.
- **Swipe pages.** New `ui/SwipePager` wraps the Insights tab body:
  parent pan activates at ±32 px / fails vertically at ±12 px, so chart scrub
  (±8 px) keeps priority. Swipe left/right changes Overview → Categories →
  Trends → Merchants.

### Pass B — latest Material & chart settings (landed)

- **React Native Paper 5.15.4** (latest stable, published 2026-11-02) installed
  through `npx expo install`. `PaperThemeProvider` maps our M3 roles into Paper's
  MD3 theme, including elevation levels, shape roundness and Expo vector icons.
  The 6.0.0-alpha.2 line exists but is deliberately not shipped; Paper 5.15.4 is
  the newest production-safe release and the version verified with Expo 57.
- **Migrated control internals:** `Button` (contained/tonal/text/error, ripple,
  Material state layer) and `M3Switch` (Paper Switch, works on web) now use
  Paper. Geometry, heights and the public wrapper API stayed the same; screens
  did not change.
- **Chart settings page** (`/settings/charts`): live preview, trend style
  (line/area/bars), colour source, grid, average, markers, tooltips, animation,
  donut/pie, centre total, point budget (60/120/240), reset. Persisted in the new
  `charts` settings group; legacy `appearance.chartColors: 'category'` migrates
  once.
- **Chart components honour it.** `LineChart`/`BarChart` read
  `useChartSettings` for grid/average/markers/tooltips/animation and sample long
  series down to the point budget (first/last preserved; taps map back to the
  original point). `DonutChart` supports real pie slices and the global centre
  total. New shared primitives: `MiniLineChart` (hero), `MiniBars` (weekday),
  `BarList` (share bars), `ChartLegend`.
- **Per-widget chart options**: dashboard configure sheet now shows Global
  default/Line/Area/Bars, average and grid for `spending_trend` and
  `net_worth_trend`; widgets follow the global style when not overridden.
- **Insights range persistence.** Category, merchant and ledger drill-downs now
  carry `from`/`to`; category and merchant detail open on that custom range, and
  their charts/lists use the same window. The ledger seeds its From/To filter
  from the route. Merchant detail gained a Custom range chip + sheet.
- **Notification panel.** The header bell now opens a real panel (urgent/action/
  idea counts, daily check-in, top six inbox items, Financial Inbox and
  notification settings). It is derived from the same `getInbox()` queue, not a
  second inbox.
- **AI expense fill.** The composer has a "Describe it" bar: DeepSeek parses the
  sentence and fills amount/merchant/category/account/date/notes in place;
  complex intents (shared/loan/recurring) hand off to `/quick-entry` for full
  verification. The backwards privacy gate that hid AI suggestions when privacy
  was `'none'` is removed.
- **Android widget palette.** Snapshots now carry `palette` + `accentHex`, and
  widget tokens are generated from the same M3 tonal palette as the app (legacy
  magenta fallback removed).

### Verification so far

- `npm run typecheck` clean after every slice; `npm test` 185/185 green.
- Web export rebuilt; `home-current.png` confirms the hero chart; `charts-settings.png`
  confirms the new page and live preview; `composer-paper.png` confirms the Paper
  button; `appearance-paper.png` confirms Paper buttons/switch in the theme
  controls; `notifications-panel.png` confirms the bell panel.
- `scripts/verify-m3.mjs` updated to the new bottom-nav contract — **14/14**.
- `scripts/verify-modals.mjs` — **33/33**.
- New `scripts/verify-notifications.mjs` — **10/10** (bell → panel → close →
  reopen, no runtime errors).
- Still to do: a swipe-pager regression script, an Insights range-persistence
  check, and an Android APK pass for Paper controls, widgets, back and keyboard.

