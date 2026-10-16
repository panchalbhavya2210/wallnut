# Wallnut — project status & living task list

> **Read this first.** This file is the handoff document for any new session
> (human or agent). Keep it updated as work lands. Last updated: 2026-10-16 (GitHub Actions CI/CD).

---

## 1. What this is

**Wallnut** — a premium, local-first personal finance app (React Native + Expo
SDK 57, expo-router, SQLite via expo-sqlite + Drizzle ORM). Android is the
primary target; the web build is the development/preview environment. No
backend, no accounts, no network calls, no analytics.

Positioning: “a private, local-first personal finance command centre that turns
raw transactions into financial intelligence.”

---

## 2. How to run, verify and screenshot

```bash
npm run typecheck        # tsc --noEmit (must stay clean)
npm test                 # vitest unit tests (money/analytics/accounting/quick-entry)
npm run db:generate      # drizzle-kit generate + inline migrations bundle

npx expo export --platform web   # build the browser bundle into dist/
node scripts/serve-web.mjs 8081  # serve dist/ with COOP/COEP (required!)
node scripts/verify-web.mjs http://localhost:8081 home 390 844 "NET WORTH"

npx expo prebuild --platform android        # apply app.json plugins (widgets/fonts) — back up the keystore first
powershell -ExecutionPolicy Bypass -File scripts/build-apk.ps1   # widgets need a native build, never Expo Go
```

* The app entry point is the repo-root `index.ts` (custom entry): it registers the
  Android widget task handler and then imports `expo-router/entry` **last**. Keep
  that order; Expo Router must remain the root component.
* `scripts/serve-web.mjs` serves `dist/` — after source changes run
  `npx expo export --platform web` again or the browser keeps the old bundle.

* `scripts/serve-web.mjs` — static server. **Isolation headers are mandatory**:
  expo-sqlite's web build needs SharedArrayBuffer for Drizzle's queries. Pass
  `--memory` only for a non-functional smoke test.
* `scripts/verify-web.mjs` — headless Chrome (puppeteer-core) that waits for real
  content, writes `screenshots/<name>.png`, dumps the DOM to `.expo/verify/…`,
  prints console errors and the app's own `[boot]` timing logs.
* Screenshots for the user live in `screenshots/`.
* **Never re-introduce `metro.config.js` beyond `config.resolver.assetExts.push('wasm')`**:
  overriding the middleware or Babel transformer breaks Metro's worker chunking
  ("Worker chunk not found"). The `.sql` migrations are inlined by
  `scripts/build-migrations.mjs` instead of a custom transformer.

---

## 3. Architecture map

```
src/
  app/                     expo-router routes
    _layout.tsx            providers, bootstrap gate, Stack, toast/confirm hosts, widget auto-refresh
    quick-entry.tsx        AI quick entry (natural language → strict command → confirm → services)
    home.tsx               deep-link redirect (wallnut://home)
    (app)/                 drawer shell: Home, Transactions, Analytics + searchable drawer + floating add
    ai.tsx                 Financial Intelligence assistant (deterministic answers + DeepSeek explanations)
    onboarding.tsx         first-run wizard (currency → name → first account)
    transaction/new.tsx    quick-add composer (keypad, pickers, splits, tags, receipts, AI category suggest)
    transaction/[id].tsx   detail: splits, tags, attachments, review state
    accounts/, account/[id], account-groups, adjust
    budgets/, budget/[id], goals/, goal/[id], debts/, debt/new, person/[id]
    shared/ (index, group/[id], expense/new, expense/[id]) — Splitwise-style shared expenses
    recurring/, installments, investments, calendar, review, rules, templates, tags
    merchants, reports/{index,cashflow,monthly,health}, data, settings/* (incl. settings/ai, settings/widgets)
    +not-found.tsx         friendly 404 (never a dev error page)
  ai/                      AI MVP (DeepSeek only)
    types.ts               provider interface, errors, friendly messages
    deepseek.ts            chat-completions provider (JSON mode, timeouts, typed errors)
    client.ts              orchestrator: settings → cache → provider → validated result + usage metering
    privacy.ts             privacy filter (mode, identifier stripping, merchant masking)
    context.ts             compact engine-built context (no raw tables)
    resolve.ts             intent → financial-engine query → deterministic fact
    intents.ts             pure question → intent detection
    affordability.ts       pure "can I afford this" maths
    features.ts            categorization · insights · assistant · affordability · monthly review
    cache.ts / hash.ts     SQLite ai_cache + deterministic request hashing
    resolve.ts, intents.ts, affordability.ts are pure where possible and unit-tested
    commands/              AI Quick Entry (financial command interface)
      schema.ts            strict AiFinancialCommand parser/validator + missing-field + confirmation policy (pure)
      context.ts           local data + names-only prompt context (no balances, no ids)
      provider.ts          FinancialCommandParser abstraction (DeepSeek via runAiFeature)
      resolve.ts           name→row resolution, questions, answers, confirmation rows (pure)
      execute.ts           executes ONLY through existing services (transactions/debts/shared/goals/recurring)
      index.ts             orchestrator: analyze → ask → confirm → execute (single UI API)
  widgets/                 Android home-screen widgets (react-native-android-widget)
    snapshot.ts            WidgetDataService: ledger → serialized snapshot → widget_snapshots table
    components.tsx         Snapshot/Balance/QuickAdd/Upcoming renderers ('use no memo', primitives only)
    widget-task-handler.tsx  headless task: added/update/resized → snapshot → renderWidget
    register.ts/.android.ts  platform-split task-handler registration (no-op off Android)
    publish.ts/.android.ts   requestWidgetUpdate push after ledger/settings changes
    pin.ts/.android.ts       launcher "add to home screen" prompt
    useWidgetAutoRefresh.ts  debounced db-revision + settings subscription
    defs.ts                widget provider names/labels (must match app.json)
  db/
    schema.ts              32 tables + relations (money = integer minor units); ai_cache; widget_snapshots
    client.ts              NATIVE driver: expo-sqlite sync + drizzle/expo-sqlite + migrator
    client.web.ts          WEB driver: expo-sqlite ASYNC + drizzle/sqlite-proxy
                           (see §5 — the sync bridge truncates results in browsers)
    migrations-bundle.ts   generated: SQL inlined as strings (npm run db:generate)
    bootstrap.ts           open DB → hydrate settings → system rows → seed → post schedules
  services/                all business logic; SQL aggregation lives here
    net-worth.service.ts   canonical net worth: accounts (+flags) + receivables − payables, incl. history
    safe-to-spend.service.ts  flagship safe-to-spend + available + per-day
    shopping.service.ts    shopping lists → one itemised expense (splits per item)
    shared.service.ts      shared expenses: groups, dynamic line items, multi-payer bills;
                           balances are computed (Σ paid − Σ share + settlements), the user's
                           own cash is an `expense` + `lending` mirror, settlements are
                           `debt_payment` — never income/expense
  utils/split.ts           pure split maths (equal/exact/%/shares, paise-safe), proportional
                           user↔person attribution, exact member balances, settlement
                           suggestions, item totals and the ledger plan
  security/                app lock (pin.ts hashing, PinPad, LockScreen), enforced by app/_layout
  theme/fonts.ts           font registry (Inter, Poppins, Manrope, DM Sans, Sora, Outfit, Space Grotesk, Lora)
  theme/colors.ts          19 accents (incl. red + neon set) with dark/light tokens
  components/              ui kit, charts (react-native-svg), widgets, editors, DrawerContent, BottomNav, ForecastCard
  theme/                   colors (dark/light + 19 accents), typography, spacing, radius, shadows, material
  stores/                  zustand: settings, db revision, ui (toasts/selection/account scope/chart lock)
  hooks/                   useQuery (re-runs on db revision), useMoney, useNow, useKeyboardHeight
scripts/                   build-migrations, serve-web, verify-web
tests/                     vitest — accounting rules, money maths, AI privacy/hash/intents/affordability/quick-entry
index.ts                   custom entry: registers widget task handler, then expo-router/entry (must stay last)
```

### Accounting model (the part that must never regress)
* Amounts are **signed integer minor units** (paise). `transactions.amount` is signed
  from the perspective of `account_id`; expenses negative, income positive,
  refunds positive (they net against expenses), adjustments excluded from
  income/expense, `lending`/`borrowing`/`debt_payment` for money owed,
  `transfer` negative with `transfer_account_id` holding the mirror leg.
* Transfers are **never** expenses and **never** change net worth.
* A single transfer row stores only the source leg; balances for the destination
  account are derived from `transfer_account_id`.
* Splits live in `transaction_splits` and are expanded for analytics by the
  `effective_ledger` view.
* **Shared expenses never inflate personal spending** (`services/shared.service.ts`,
  `utils/split.ts`): a bill can have dynamic line items (train + hotel +…) and one
  or more payers. You pay ₹20,000 of a ₹30,000 villa with a ₹7,500 share → an
  `expense` of ₹7,500 plus a `lending` row of ₹12,500 (cash out, receivable).
  Someone else pays your share → no cash row at all, only a payable. Settlements
  are `debt_payment` rows when the user's cash moves (any two members can settle).
  Balances are **computed** — `member balance = Σ paid − Σ share (+/− settlements)`
  — and shared expenses deliberately write no `debts` rows, so net worth + Money
  Owed merge them exactly once. Group screens show full member balances and the
  fewest-transfers settlement list.
* Account balances are maintained in the same SQL transaction as the row write,
  and can be recomputed (`recalculateAllBalances`) after imports/restores.
* **Net worth is canonical** (`services/net-worth.service.ts`): accounts that
  pass `include_in_net_worth` **plus receivables minus payables** from the debt
  tables. Home, drawer, Accounts, Analytics, Health and AI all read it, so a
  loan converts cash into a receivable instead of looking like a loss.
  History integrates account movements *and* debt creation/payments per day.
* Rules/merchant matching are **pure** (`utils/rules.ts`, `utils/merchant.ts`)
  so the import pipeline and vitest run without the database; services re-export.

---

## 4. Status

### Working (verified in the browser at 390×844)
* Boot: DB opens in ~1.4 s on web, demo seed in ~1.4 s, dashboard renders with real data.
* Navigation: hamburger drawer (searchable destination index, net-worth summary, BETA badge), floating add button, no bottom tabs; detail screens keep a back chevron.
* Home dashboard: account scope selector (All accounts / one account — every balance + analytic follows the selection), 26 widgets (net worth with count-up, cash flow, spending, pace, savings-rate gauge, trends, categories, budgets, goals, debts, subscriptions, instalments, reminders, insights, money flow, recent, accounts…), drag-to-reorder editor, presets, per-widget period/size configuration.
* Charts: scrub gestures that don't scroll the page (scroll lock + activation/failure offsets, web `touchAction`), persistent tooltips, auto-baseline for balance/net-worth charts, smoother areas and end-point markers.
* AI MVP (DeepSeek, BYO key in Settings → AI & Intelligence): transaction categorization with accept/dismiss, Home AI insight card, Financial Intelligence assistant (deterministic engine answer first, AI explanation second), "Can I afford this?" maths + explanation, monthly-review summary, SQLite response cache with TTLs, privacy filter (none/anonymized/detailed), usage + estimated cost metering, graceful offline/disabled handling.
* Recurring: monthly schedules anchored to their day (the 31st skips February instead of drifting), manual schedules keep overdue occurrences visible ("due now"), custom cadence monthly-equivalent fixed, `anchor_day` migration backfills existing rows.
* Accounts: filled net-worth hero (assets/liabilities/spendable), grouped account cards with institution/type, card utilisation bars; **Accounts page and charts both rebuilt after user review**.
* Keyboard-safe sheets: bottom sheets lift with the soft keyboard (there was no keyboard handling before — popups with inputs were covered by the keyboard on Android).
* Material: `@expo/ui` Material You wallpaper palette on Android 12+ (no third-party module), stronger tonal filled surfaces, filled net-worth hero, material palette visibly restyles cards/inputs.
* Transactions: search, tabs, advanced filters, date grouping, swipe actions, multi-select bulk edit.
* Composer: keypad-first, type switch, pickers, splits with balance validation, tags, receipts, "needs review" toggle, edit mode.
* Transaction detail: splits, tags, attachments, duplicate/delete/review.
* Accounts: groups, visibility flags, credit-card panel, investment valuation, reconcile + adjustment, archive.
* Budgets (rollover, safe-to-spend, projection, pace marker), goals (+ contributions), money owed, recurring & subscriptions (annualised, upcoming, post/skip), instalments, calendar, review queue, rules engine + editor, templates, tags, merchants/aliases, categories, analytics, reports, import wizard, CSV/JSON export, backup/restore.
* Settings: appearance (theme/light+dark, 6 accents, font scale, reduce motion), dashboard, finance, transactions, notifications, security, AI & Intelligence, about.
* **Pass 13 (ledger correctness & security)**: canonical net worth with money owed everywhere; forecast now includes pace-based expected spending; imports run merchant aliases + the rules engine and respect the auto-review setting; backup covers all 23 tables with a table-by-table restore confirmation and rollback-safe replace; account delete/merge no longer corrupt transfer legs; app lock is **real** (PIN setup + biometrics + auto-lock timeout + Lock now — verified end-to-end in the browser with `scripts/verify-lock.mjs`).
* **Pass 14 (accounts, navigation, fonts, reports, shopping lists)**:
  - **Accounts**: colour + icon pickers in the editor; new account types **wallet, mortgage, insurance** (mortgage is a liability in net worth, insurance is non-spendable); default colour/icon per type; account colours now flow into lists/charts.
  - **Analytics "Accounts" section**: spending per account, every account in its own colour (donut + list + balances), transfers excluded by construction.
  - **One-handed navigation**: bottom nav (Home · Activity · centre create · Analytics · More) with the create action in the thumb zone; the drawer remains behind More and the header menu.
  - **Fonts**: Appearance → Typeface with 8 families (Inter, Poppins, Manrope, DM Sans, Sora, Outfit, Space Grotesk, Lora), each loaded on demand; picker previews each name in its own face.
  - **Detailed reports**: Balance, Outlook (safe-to-spend + forecast + upcoming), Spending, Credit (cards/loans/mortgages, utilisation, cycles, pay shortcuts), Assets (composition, investments, receivables) — all in Reports.
  - **Shopping lists**: new tables + screen; items with name/price/qty, tick-off, and a **Create transaction** button at the top that writes ONE expense whose splits itemise the purchase (grouping without double counting). Verified end-to-end with `scripts/verify-shopping.mjs`.
  - Backup/restore and wipe now share one table list (`db/tables.ts`) so they can never drift again.
  - New reports/routes/screens included in backup and in the drawer index.
* **Pass 15 (shared expenses)**: `/shared` overview, group screen (expenses/balances/members/settled) with full member balances and fewest-transfer settlement suggestions, shared composer with dynamic line items (train + hotel in one batch), equal/exact/%/shares splits, multi-payer split payments, person-list pickers (not chips), payer selection, computed balances merged into Money Owed + net worth, partial settlements with undo, settlements between any two members, person-screen shared activity, composer "Shared" mode, QuickAdd shortcut, drawer entry, quiet opt-in reminders. Verified end-to-end with `scripts/verify-shared.mjs` (42 checks) and `scripts/verify-trip.mjs` (43 checks, multi-payer trip).
* **Pass 16 (AI quick entry + Android widgets)**:
  - **AI Quick Entry** (`src/ai/commands/`): natural language → DeepSeek JSON → **strict `AiFinancialCommand` schema** → local name resolution → clarification questions → confirmation per setting → **existing services only**. The model never writes to the DB and never invents account/category/goal/person names; unknown names become questions (two accounts both called “Kotak Bank” → “Which account is ‘Kotak Bank’?” with balances as chips). Intents: CREATE_TRANSACTION / INCOME / TRANSFER / SHARED_EXPENSE / LOAN / LENDING / SETTLEMENT / RECURRING / GOAL_CONTRIBUTION / UNKNOWN. Confirmation modes: ALWAYS (full card) / SMART (one-tap card for simple, full for high-risk) / AUTO (trusted quick save with undo; transfers/debts/splits/large always confirm). Local answers never re-call the model; duplicate signature guard; privacy filter applies to context while the typed sentence is passed verbatim so large amounts survive sanitization. Entry points: FAB/bottom-nav “Ask Wallnut”, Financial Intelligence, widget Quick Add, `wallnut://quick-entry`. 21 unit tests in `tests/quick-entry.test.ts`.
  - **Android home-screen widgets** (`react-native-android-widget` 0.22.1): four providers — Snapshot (2×2 safe-to-spend + today), Balance (4×2 net worth/available/safe), QuickAdd (4×2 expense/income/transfer + Ask Wallnut), Upcoming (4×2 next recurring bills). Config plugin in `app.json`; custom entry `index.ts` registers the task handler then imports `expo-router/entry`; headless task handler; `WidgetDataService` (`widget_snapshots` table, migration 0009) built from the canonical services; debounced refresh on every db-revision/settings change + on app start + Android’s 30-minute `updatePeriodMillis`; deep links (`wallnut://home|quick-entry|calendar|settings/widgets`) via native `OPEN_URI`; light/dark variants following the active accent; Inter bundled for widgets; Settings → Widgets (enabled, show amounts, default widget, launcher pin prompt). Widgets are `home_screen` only — amounts never on the lock screen (enforced at build time, stated honestly in settings).
  - **19 accents** in Appearance (added red, neon pink/purple/green/cyan/orange, lime, teal, sky, gold, orange, coral) and **calmer button feedback** (shallower press, no release overshoot).

### Known open items
1. **Device palette (Material You wallpaper colours)** — now powered by first-party `@expo/ui`
   (`getMaterialColors`, Android 12+; falls back honestly below that). Needs the Android build
   (works in Expo Go too); web/iOS report it unavailable. The import is guarded to the native
   bridge file only — `@expo/ui` throws if required on web.
2. Unit tests are in place and green (143 tests: money maths, accounting rules, budget maths,
   anchored recurring schedules, investments, duplicate detection, CSV import, date ranges,
   category tree, palette generation, AI privacy/hash/intents/affordability, quick-entry
   schema/resolution/confirmation, inbox priorities, shared-expense splits/balances/items/settlements).
   DB-level scenario tests against a real SQLite (better-sqlite3) remain a nice-to-have.
3. Branding assets — **done (Pass 12)**: `scripts/generate-assets.ps1` + `assets/brand-source.png`; regenerate whenever the mark changes.
4. Recurring editor polish still open: end-date + reminder picker + notes fields
   (mechanics/anchoring/overdue are done), and multi-day monthly schedules (Wallet iOS's
   "1st and 28th") are not modelled.
5. AI MVP follow-ups: import-time batch categorization, rule-creation from accepted
   corrections, confidence scoring beyond the model's own number, and a shared
   alias map so categorization stops calling DeepSeek for repeat merchants
   (the 30-day cache covers the common case).
6. The composer's split-sheet amount field should move to the shared `AmountInput`.
7. Charts could go further visually (axes labels on gridlines, donut highlights) — the
   scrub/scroll reliability and balance auto-baseline issues are fixed.

### Explicitly out of scope for V1
Bank connectivity, cloud sync, multi-user, payment initiation, market data,
AI/NL search, PDF/XLSX parsing, SMS ingestion (architecture ready:
`src/services/sms/` + the shared import pipeline).

---

## 5. Hard-won gotchas (do not rediscover these)

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Worker chunk not found` at bundle time | custom `metro.config.js` middleware/transformer overrides | keep the Metro config minimal (wasm assets only) |
| `Unable to resolve wa-sqlite.wasm` | `wasm` missing from `assetExts` | keep `assetExts.push('wasm')` |
| `Unterminated string in JSON` at boot | expo-sqlite's **sync** web bridge truncates results (drizzle's Expo driver is sync-only) | web uses `client.web.ts` (async + `drizzle-orm/sqlite-proxy`) |
| DB never opens / 30 s timeout | COOP/COEP headers missing → no SharedArrayBuffer | serve with `scripts/serve-web.mjs` (headers on by default) |
| `table accounts already exists` | bookkeeping table renamed between drivers | `client.web.ts` adopts `__drizzle_migrations` and tolerates "already exists" statements |
| Empty app in the browser preview | production web export has `__DEV__ === false` | bootstrap seeds demo data on web and marks onboarding complete (release Android keeps the real wizard) |
| Dragging across a chart scrolls the page | the native ScrollView steals horizontal drags inside modals/scroll screens | charts lock the scroll screen (`chartScrubbing` store) on pan activation, use `activeOffsetX`/`failOffsetY`, web `touchAction="pan-y"` |
| Balance charts flatlined near the bottom | zero-based axis for balance data | `LineChart baseline="auto"` for net worth/account/portfolio charts |
| FAB floating over the drawer | FAB rendered as a sibling of `<Drawer>` | render it from `screenLayout` so it lives inside the drawer scene |
| `Cannot find native module 'ExpoUI'` on web | `@expo/ui/jetpack-compose` is Android-only and throws when required on web | only require it in `device-palette.service.native.ts`, guarded + Android-only |
| Recurring "31st" payment drifts to the 28th | date-fns `addMonths` clamps month-end | `anchor_day` column + skip months without the anchored day (`advanceRecurrence`) |
| Inputs hidden behind the keyboard (Android) | RN `Modal` windows do not `adjustResize` | `useKeyboardHeight` lifts the bottom sheet and caps its max height |
| Widgets crash/blank after a React Compiler build | compiler memoizes widget components by adding hooks — widget primitives must not use hooks | `'use no memo';` at the top of `src/widgets/components.tsx` |
| Widget data never updates / "Worker chunk" style startup errors | the widget task handler must be registered in the entry point | custom `index.ts` registers the handler, then imports `expo-router/entry` last |
| `expo prebuild --platform android` deleted the release keystore | prebuild clears `android/` | keystore backed up to `%TEMP%\opencode` before prebuild; restore it after (or keep a copy outside `android/`) |
| `react-native-android-widget` plugin generates no widgets | plugin param `widgets` missing (expo install adds the plugin bare) | keep the full plugin config in `app.json` (widgets + fonts) |
| Protocol error (Emulation.setDeviceMetricsOverride) in the verify scripts | Chrome 154 rejects viewport emulation from puppeteer-core 25.x | scripts launch with `defaultViewport: null`; the window size defines the viewport (~500×748 in headless — the OS minimum window width) |

---

## 6. Wallet by BudgetBakers — research & decisions

Researched `budgetbakers.com/en/features` and Material Design 3's colour/data-viz guidance.

| Wallet feature | Decision |
| --- | --- |
| Smart budgets: recurring + one-time, category tracking, rollover, real-time visual indicators | **Adopted** — budgets support weekly/monthly/yearly/custom (one-time via a custom range), per-category, rollover toggle, and now **circular gauges** with safe-to-spend and end-of-period projection. |
| Interactive charts, trend analysis, forecasting, anomaly detection | **Adopted** — trend/line/bar/donut/flow charts with scrub tooltips, deterministic month-end forecast, and a review queue that flags unusual amounts. |
| Scheduled payments: reminders, subscription management, payment calendar | **Adopted** — recurring + subscriptions with annualised cost, upcoming list, per-launch posting, in-app reminders, calendar view. |
| Receipt scanning & storage, split transactions | **Adopted (local)** — attachments stored on-device, real split editor with balance validation. |
| Reports: CSV/PDF, tax reports, custom ranges | **Partly** — CSV export (transactions + monthly summary), JSON backup/restore, custom periods. PDF/tax-report templates are not in V1. |
| Multi-currency with live exchange rates | **Storage yes, rates no** — currencies are first-class in storage and formatting; there is no FX feed (offline-first). |
| Bank sync (15,000+ banks, PSD2), cloud sync, family sharing, AI/ML categorisation | **Declined for V1** — would require a backend, credentials or network calls, which contradicts the local-first promise. Deterministic rules replace the AI categorisation; SMS import is the planned next ingestion path. |
| Needs vs wants classification | **Declined** — not a Wallet feature, and tags already cover “Trip / Work / Family / Tax” without adding a second taxonomy to maintain. |

Design guidance applied: charts take their colour from the active palette
(`buildChartTokens`) with Material's primary/secondary/tertiary leading multi-series charts;
gauges and count-ups provide the “visual indicators” Wallet is known for; motion respects the
reduce-motion setting.

---

## 7. Next actions (priority order)

1. **Phase B of the second brief: Financial Inbox** — unify the review queue into one attention queue (URGENT / ACTION REQUIRED / SUGGESTION / INFORMATION) with accept/edit/create/ignore actions. Then C (Safe-to-Spend v2), D (forecast warnings), E (subscription price changes), F–I in order (see the phase status map below).
2. **Pass 16 APK — built (2026-10-07)**: `wallnut-2026-10-07.apk` (74.5 MB, warm build 4m 13s) — verified with `aapt2` to contain all four widget receivers (`Snapshot`, `Balance`, `QuickAdd`, `Upcoming` with labels), `WIDGET_CLICK` + `APPWIDGET_UPDATE` actions, `widgetCategory=home_screen`, `updatePeriodMillis=1800000`, the `wallnut://` deep-link scheme, and the bundled Inter fonts. Install with `adb install -r wallnut-2026-10-07.apk` (or copy it to the phone), then add a Wallnut widget from the launcher — widgets never work in Expo Go.
3. Quick-entry follow-ups: on-device speech input (the composer relies on the keyboard mic today), a widget “recent transactions” provider, and per-widget configuration screens.
4. Recurring editor fields (end date, reminder offsets, notes) and multi-day monthly schedules.
5. AI follow-ups: import-time categorization review, rules created from accepted corrections, merchant→category alias memory.
6. SMS ingestion (Phase 9 of the master brief) — needs the Android native reader; nothing fake ships before that.
7. PDF/XLSX statement import — only with a real parser; CSV wizard stays the supported path for now.
8. Screenshot review at phone widths once Chrome viewport emulation is usable again (puppeteer/Chrome CDP mismatch — see §5).

### Feature roadmap — status map (user's 23-point brief)

| # | Feature | Status |
| --- | --- | --- |
| 2 | Credit cards own system | **Partial** — limit/available/utilisation, statement + due days, min payment in the editor; still to do: statement panel + min/full due surfaced on the card, one-tap "Pay card" (bank → card transfer, never an expense) |
| 3 | Safe-to-spend flagship | **Partial** — per-budget safe-to-spend exists; global flagship (income − bills − savings − commitments, per-day) still to do |
| 4 | Net worth understands everything + monthly history | **Mostly done** — accounts (+flags) + receivables − payables across every screen and the trend; month table still to do |
| 5 | Statement import | **Partial** — CSV wizard (map → preview → dedupe → review → commit); PDF/paste-text sources still to do |
| 6 | SMS transaction detection | **Architecture ready** (`src/services/sms/`), native Android receiver + tri-state setting still to do |
| 7 | Rules engine | **Done** (rules + editor). Advanced AND/OR conditions are future |
| 8 | Recurring detection | **To do** (scan history for monthly patterns → suggest schedules) |
| 9 | Subscription waste detector | **Partial** — annualised summary + AI review; dedicated "review your subscriptions" screen to do |
| 10 | Cash-flow calendar | **Partial** — day cells show actual spent/income + scheduled markers; expected-monthly per day and payday emphasis to do |
| 11 | Cash-flow forecasting | **Partial** — budget projection + spending pace; 30-day projected balance line to do |
| 12 | Goals with funding | **Mostly done** — target/saved/required-monthly; "behind pace" badge to do |
| 13 | "What changed?" analytics | **Partial** — monthly comparison widget + report; dedicated compact section next |
| 14 | Merchant intelligence | **Done** — merchant detail with totals, average, trend, categories |
| 15 | Tags | **Done** — tags, picker, filtering; a tag report screen is future |
| 16 | Reimbursements | **Partial (Pass 15)** — shared expenses cover split bills, receivables and payback tracking; a reimbursement status on ordinary tagged transactions is still future |
| 17 | Split transactions | **Done** — split editor with balance validation, expanded by `effective_ledger` |
| 18 | Split bills → Money owed | **Done (Pass 15)** — shared expenses: people, groups, 4 split types, payer selection, computed balances, partial settlements; flows into Money Owed + net worth |
| 19 | Powerful search | **Partial** — search + advanced filters; natural-language search will ride on the AI assistant |
| 20 | Export / backup | **Mostly done** — CSV/JSON export + restore; Excel/PDF + automatic local backup to do |
| 21 | App lock | **Done (Pass 13)** — biometrics (native) + salted-hash PIN fallback + auto-lock timeout + Lock now, enforced by the root layout |
| 22 | Privacy mode | **To do** — global "hide balances" eye on Home + a `privacy.hideAmounts` setting |
| 23 | Custom dashboard | **Done** — drag-to-reorder, visibility, per-widget config, presets |

> **Done in Pass 11: safe-to-spend flagship, credit-card payment flow, privacy mode, "What changed?" section, recurring detection.** Everything else stays on the roadmap above.

### Pass 14 — user-requested additions (all landed)

| Request | Status |
| --- | --- |
| Colour picking for accounts | **Done** — colour + icon pickers in the account editor (22 swatches + custom hex, shared `ui/ColorField`) |
| Analytics distinguish accounts by colour | **Done** — "Accounts" section with per-account colours, spending shares, balances; tapping opens the account |
| More account types | **Done** — added **wallet, mortgage, insurance** (mortgage = liability, insurance = non-spendable); 10 types in total |
| One-handed navigation | **Done** — bottom nav (Home · Activity · create · Analytics · More) with the create action in the thumb zone; drawer stays under More/header |
| Detailed reports per area | **Done** — Balance, Outlook, Spending, Credit, Assets added to Reports (cash flow, monthly review and health already existed) |
| Shopping list feature | **Done** — lists with item name/price/qty, tick-off, and one-tap "Create transaction" that writes a single itemised expense (splits per item) |
| Font choices (Poppins etc.) | **Done** — Appearance → Typeface: Inter, Poppins, Manrope, DM Sans, Sora, Outfit, Space Grotesk, Lora; loaded on demand |

### Second-phase brief (shared expenses → intelligence) — status map

| Phase | Feature | Status |
| --- | --- | --- |
| A | Shared expenses / Splitwise-style | **Done (Pass 15)** — groups, dynamic line items, multiple payers per bill, equal/exact/%/shares, exact member balances + fewest-transfer settlement suggestions, settlements between any members, partial settlements + undo, Money Owed + net worth merge, composer "Shared" mode, quiet opt-in reminders; verified end-to-end (`verify-shared` + `verify-trip`) |
| B | Financial Inbox | **To do** — extend the review queue into one attention queue with priorities |
| C | Safe-to-Spend v2 | **Partial / to do** — add emergency reserve, credit-card obligations, confirmed expected income; keep the visible breakdown |
| D | Cash-flow forecast warnings | **Partial / to do** — actual/scheduled/estimated timeline + low-balance runway warning (never "you will run out") |
| E | Subscription intelligence | **Partial** — annualised summary + detection exist; price-increase detection and a dedicated review screen remain |
| F | Financial health score | **To do** — transparent component scores (the current health screen is deliberately descriptive only) |
| G | Goal projections | **To do** — projected completion date, contribution slider, cross-goal impact |
| H | What-If simulator | **To do** — copy/simulation model over the real ledger; must never mutate real data |
| I | Anomaly detection | **Partial** — transaction-size review + insights exist; merchant/category vs 3-month average + paycheck detection remain |

> Rules that carry across every phase: AI never computes financial values (the
> deterministic engine answers first, AI only explains); local-first, no bank
> credentials; each phase follows data model → business logic → calculation → UI →
> persistence → restart-verify, and shared expenses may never inflate personal
> spending, settlements may never become income/expense, and credit-card payments
> stay transfers.


---

## 8. Pass log

- **Pass 1 � foundation**: schema (14 tables), services, analytics engine, import pipeline, seed data, theme system.
- **Pass 2 � pass-2 scope**: groups, credit cards, splits UI, adjust/reconcile, rules, goals, money owed, installments, templates, attachments, review queue, calendar, forecast, monthly review, financial health, saved reports, dashboard editor, settings tree.
- **Pass 3 � runtime truth**: web driver switched to the async proxy (the sync bridge truncated results); migration adoption for existing browsers; transfer net-worth fix; net-worth period boundary; 59 unit tests green; `tsc` clean.
- **Pass 4 � palette & motion**: Material tonal palette generator + Appearance controls (palette, device colours, chart colours); charts follow the selected palette; gauge rings for budgets/savings/utilization/goals; count-up hero numbers; bouncy presses on buttons, chips, icon buttons, tabs, FAB; spring gauge sweeps; screen entrance transitions and stack animations; back button falls back to the dashboard on deep links.
- **Pass 5 � breathing room**: dashboard default reduced to six widgets with 24px rhythm and one period control; repeated "This month" labels removed; borderless net-worth hero; budget list trimmed; one-time layout tidy-up for existing databases.
- **Pass 6 — interaction fixes**: tag selection visible in the composer (checkmarks + selected chips) and new tags prompt for a name; review queue no longer floods on expected charges (income and recurring excluded, 6x average with a 10,000 floor, transfers labelled as transfers); launch notification when recurring payments/installments post.
- **Pass 7 — navigation, scope, charts, material**: bottom tabs → searchable hamburger drawer + floating add button; Home account scope selector (All accounts / per-account) that re-scopes the hero and analytics; chart rewrite (scrub vs scroll lock, persistent tooltips, auto-baseline for balances, stronger areas); keyboard-safe bottom sheets; Material You via `@expo/ui` + filled tonal surfaces; Accounts screen rebuilt after review; recurring anchoring fix (month-end skip), overdue visibility, custom-cadence maths, `ai_cache`/`anchor_day` migrations.
- **Pass 8 — AI MVP (DeepSeek)**: provider abstraction + DeepSeek JSON provider; privacy filter; engine-built compact context; intent detection → engine query → deterministic fact → AI explanation; transaction categorization with accept/dismiss in the composer; Home AI insight card; Financial Intelligence assistant screen; affordability ("can I afford ₹X") using pure, tested maths; monthly-review AI block; AI & Intelligence settings (BYO key stored locally, privacy modes, feature toggles, model/base URL, test connection, usage + estimated cost, clear cache); SQLite AI cache with deterministic hashing and TTLs; all AI paths degrade gracefully (disabled / no key / offline / timeout / rate limit / invalid JSON).
- **Pass 9 — brand colour + assistant polish**: merged the stale-feeling indigo identity into a **vivid magenta brand** (`magenta` accent is the new default, one-time migration from the old indigo default); deep violet-tinted dark palette; gradient net-worth hero (deep tonal accent gradient, vivid accent line, white number) and gradient FAB via `expo-linear-gradient`; assistant answers now replace the raw fact instead of repeating it, prompts rewritten for direct, non-padded answers (₹ formatting, essential/discretionary split allowed as a general observation only), suggested-question chips moved to an always-available horizontal rail above the input, prompt versioning invalidates stale cache entries; affordability parser no longer reads the "5" in "ps5" as ₹5 and asks for a price when none is given; per-widget + route-level error boundaries so a single failing card/screen can never kill the app.
- **Crash post-mortem (beta APK)**: the first APK of this pass crashed on reaching the dashboard because its JS bundle referenced `expo-linear-gradient` while the native project had been generated before the package was installed (native module missing → render throw). Lesson recorded in §9: install dependencies first, then build; never rebuild an APK while dependency changes are still landing. The follow-up builds link the module and include crash boundaries.
- **Pass 10 — real notifications, input formatting, first-visit hints, gauges**: local OS notifications via `expo-notifications` (reminders are queued at 9:00 on their date from the same deterministic reminder engine, taps deep-link, permission requested on first enable, refresh on launch + from Settings); rupee compact amounts always use Indian terms (₹1.2L / ₹3.4Cr) even with western digit grouping; every money input (`Field money`, `AmountField`, keypad display) groups digits live while storing the raw value; `ScreenHint` first-visit explainers (dismissed per screen in settings) on Accounts/Budgets/Goals/Money owed/Recurring/Installments/Investments/Calendar/Analytics/Rules/Templates/Tags/Merchants/Review/AI; Analytics gains three Wallet-style health gauges (saved %, budgets used, card used) and a real From/To custom range; Buttons no longer hug the left (parents decide alignment); FAB moved to the bottom-right; Templates now actually prefill the composer (amount/account/category/merchant params were being ignored); fixed IST date-shift bugs (`toISOString` on local midnight) in recurring saves, merchant/category period filters; category colour picker expanded to 22 swatches + custom hex; Appearance presets (Dark · Magenta, AMOLED · Magenta/Blue, Light · Blue/Magenta) and an AMOLED true-black canvas option; greeting/account-scope spacing on Home.
- **Pass 11 — flagship accounting features (from the 23-point brief)**: **Safe to Spend** is now a flagship Home widget (available cash − upcoming bills until next income − planned goal savings − remaining budget commitments, with a per-day figure; auto-placed after the hero once via `dashboard.safeToSpendPlaced`); **credit-card payment flow** — the card panel now has Pay full / Pay minimum buttons that open a prefilled bank→card transfer (payments stay transfers, never expenses) and the composer accepts `to`/`amount` deep-link params; **Privacy mode** — `security.hideAmounts` masks every figure at the `useMoney().format` chokepoint, with an eye toggle in the Home header and a switch in Security; **What changed** section in Analytics (income/spending/saved + biggest category deltas vs previous period); **recurring detection** — `detectRecurringCandidates()` finds monthly patterns from history and the Recurring screen suggests them with Create/Dismiss (created as manual-confirmation schedules); **cash-flow-aware analytics** now fetches the previous period summary.
- **Pass 12 — branding**: the supplied W/₹ mark is now the app identity. `scripts/generate-assets.ps1` derives the full set from `assets/brand-source.png` with System.Drawing (no extra dependencies): `icon.png` (1024, supplied art on white), adaptive foreground + monochrome (black ink, alpha from darkness so anti-aliasing survives), light/dark splash marks, in-app `logo-mark-dark/light.png` and the web favicon. `app.json` wires the white adaptive background, white light splash with the black mark and a `#0A0A13` dark splash with the white mark; the boot screen and drawer header use the mark instead of the "W" tile.
- **Pass 13 — ledger correctness, backup & security**:
  - **Net worth is canonical**: new `services/net-worth.service.ts` + pure `utils/net-worth.ts`. Accounts respect `include_in_net_worth` (archived accounts still hold real money), and open **receivables/payables join as assets/liabilities** — lending no longer looks like a loss, borrowing like income. Home hero, drawer, Accounts hero, Analytics, Health and the AI all read the same aggregation; the trend integrates debt creation/payments per day.
  - **Backup completeness**: all 23 user tables (rules, goals, debts, people, installments, templates, attachments, saved reports were missing), a table-by-table confirmation before restore, deletes moved *inside* the restore transaction (a failed restore now rolls back completely), settings no longer collide on replace, and balances + fingerprints are always recomputed from the restored ledger.
  - **App lock is real**: `security/` (salted-SHA-256 PIN via expo-crypto, PIN pad, full-screen lock overlay), auto-lock timeout setting (immediately/1/5/15 min), biometrics layered on native devices, "Lock now", and a legacy-state guard so the app can never lock without a way in. Verified end-to-end with `scripts/verify-lock.mjs` (enable → set PIN → lock → wrong PIN rejected → unlock → disable).
  - **Imports run local intelligence first**: merchant aliases canonicalise names, the rules engine assigns category/account/type/tags-to-be, `autoReviewImports` decides review state, and rules are re-evaluated at commit so an edit between preview and import still applies. Rules/merchant matching moved to pure `utils/rules.ts` / `utils/merchant.ts` (testable in vitest, no DB import chain).
  - **Forecast**: the cash-flow report now renders `getForecast` with pace-based expected spending (scheduled bills subtracted to avoid double-counting), clearly labelled an estimate with its basis.
  - **Account integrity**: `deleteAccount` counts both transfer legs and blocks on debts/installments/recurring/goals; `mergeUnusedAccount` repoints both transfer legs and every reference; `bulkUpdateAccount` refuses to create self-transfers.
  - **Tests**: 85 green (9 new net-worth cases incl. debt history, 6 import-rule cases).
- **Pass 15 — shared expenses (second product brief, Phase A)**:
  - **Data model**: `shared_groups`, `shared_group_members`, `shared_expenses`,
    `shared_expense_items`, `shared_expense_payers`, `shared_expense_participants`,
    `shared_settlements` (migrations 0005–0008) + backup list. Balances are
    **computed** (`utils/split.ts` + service), never stored — editing or
    deleting an expense can never leave a stale debt.
  - **Multi-payer trips**: every expense can have several payers (split payments)
    and several line items ("Train travel + Hotel stay"). Member balances are
    exact: `Σ paid − Σ share + settlements`; the group screen shows every member's
    balance and a greedy fewest-transfers list ("Amit → You ₹8,250"), including
    transfers between two other members, which can be recorded without touching
    the user's cash.
  - **Accounting (never regress)**: a bill's amount is always the sum of its
    items. Your own cash is the only thing that moves: expense = min(paid, share),
    lending = paid − share, payable = share − paid. The account still drops by
    what you actually paid and net worth only drops by your share. Settlements are
    `debt_payment` rows when the user is a party — never income, never expense.
  - **Splits**: equal, exact, percentage (basis points), shares — paise-safe largest
    remainder; invalid totals are rejected with human-readable errors. The user's
    per-person positions use proportional attribution normalised to the exact cash
    delta, so Money Owed can never disagree with the ledger by a paisa.
  - **Money Owed + net worth merge** the computed balances and dated movements;
    no `debts` rows are written for shared expenses, so nothing double-counts.
  - **UI**: `/shared` overview (owed/owe + groups + people + recent splits), group
    screen (expenses/balances/members/settled tabs, archive, member management),
    shared composer (dynamic item rows → group → split/payer person lists with
    per-person shares → live "what this means" preview), expense detail (items,
    payers, participants, settle up), Money Owed links here, person screen shows
    shared activity + settlements with undo, the main composer's type switch gains
    a **Shared** segment, QuickAdd gains **Shared expense**, drawer entry, optional
    quiet reminders (Settings → Notifications → Shared money owed, default off,
    14-day threshold, in-app only).
  - **A11y/automation**: ListRow/Chip/PickerSheet/QuickAdd/SegmentedControl expose
    button roles + labels, composer person rows are labelled ("Payer Rahul",
    "Split Neha"), and inputs can shrink (`minWidth: 0`) so narrow layouts never
    scroll horizontally.
  - **Tests**: 122 green (17 shared-expense cases incl. the ₹4,000/4-way scenario,
    the ₹30,000 villa split payment, proportional netting, rounding normalisation,
    settlement directions, member balances, settlement suggestions, item totals).
    Verified end-to-end: `scripts/verify-shared.mjs` (42 checks) and
    `scripts/verify-trip.mjs` (43 checks: two payers on one bill, a bill paid by
    someone else, member balances, suggested transfers, cross-member settlement,
    itemised batch with detail view).

- **Pass 16 — AI quick entry + Android widgets (third brief)**: see §4 for the full list. Key invariants: the model only ever produces a validated `AiFinancialCommand` (never SQL); every write goes through the existing services; ambiguous names become questions with local options; confirmation modes gate execution (high-risk never auto-saves); widgets render from a serialized snapshot built by the canonical services and refresh on every ledger/settings change, on app start, and every 30 minutes from Android; the custom entry keeps `expo-router/entry` as the root component.

### Verification commands
`npm run typecheck` · `npm test` · `npx expo export --platform web` · `node scripts/serve-web.mjs 8081` · `node scripts/verify-web.mjs http://localhost:8081 home 390 844 "Assets"` · `node scripts/verify-web.mjs http://localhost:8081/quick-entry quick-entry 390 844 "Quick Entry"` · `node scripts/verify-web.mjs http://localhost:8081/settings/widgets settings-widgets 390 844 "Widgets enabled"` · `node scripts/capture-screens.mjs http://localhost:8081 390 844` · `node scripts/verify-lock.mjs http://localhost:8081` · `node scripts/verify-shopping.mjs http://localhost:8081` · `node scripts/verify-shared.mjs http://localhost:8081` · `node scripts/verify-trip.mjs http://localhost:8081` · `node scripts/verify-inbox.mjs http://localhost:8081`

> Widgets are native: verify them only in a real build (`npx expo prebuild --platform android` then `scripts/build-apk.ps1`), never in Expo Go or the web preview.

> `verify-web.mjs` now waits ~2.5 s after the first marker before screenshotting: the drawer contains ₹ text immediately, which made the old "wait for ₹" heuristic screenshot loading widgets. Use a marker that only exists in the main screen (`"Assets"`, `"Spendable"`, `"All schedules"`).

---

## 9. Building the APK (Android)

Toolchain lives outside the repo (no admin needed):

```
C:\Users\<you>\.toolchain\
  jdk17\                 Temurin/Zulu JDK 17 (extracted)
  android-sdk\           Android SDK (cmdline-tools + platform-tools + platform 36 + build-tools 36)
```

One-time setup:

```powershell
# 1. JDK (Azul CDN is fast; Adoptium was throttled on this network)
curl.exe -L -o "$env:USERPROFILE\.toolchain\jdk17.zip" https://cdn.azul.com/zulu/bin/zulu17.54.21-ca-jdk17.0.13-win_x64.zip
Expand-Archive "$env:USERPROFILE\.toolchain\jdk17.zip" "$env:USERPROFILE\.toolchain"

# 2. Android command-line tools
curl.exe -L -o "$env:USERPROFILE\.toolchain\cmdline-tools.zip" https://dl.google.com/android/repository/commandlinetools-win-13114758_latest.zip
# extract so the tools land in .toolchain\android-sdk\cmdline-tools\latest

# 3. SDK packages (accepts licences)
powershell -ExecutionPolicy Bypass -File scripts/setup-android.ps1
```

Then build + install:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-apk.ps1
adb install -r wallnut-YYYY-MM-DD.apk      # or copy the APK to the phone and tap it
```

Notes:
* `scripts/build-apk.ps1` creates `android/app/wallnut-release.keystore` on first run and wires the
  signing config via `gradle.properties` (`WALLNUT_*` properties) � keep the keystore to publish updates.
* The APK is universal for real devices (arm64-v8a + armeabi-v7a), New Architecture + Hermes enabled.
* `app.json` uses the placeholder Expo icons until the branding pass (`scripts/generate-assets.mjs`).
* A cold release build takes ~29 minutes on this machine (mostly C++ for reanimated/worklets);
  warm rebuilds after JS-only changes are much faster. Expect ~70 MB.
* The release bundle embeds the JS at `createBundleReleaseJsAndAssets` time, so always rebuild
  after source changes — running the old APK will not pick up new code.

### Toolchain actually installed on this machine
- JDK 17.0.13 (Zulu): `C:\Users\bhavy\.toolchain\zulu17.54.21-ca-jdk17.0.13-win_x64`
- Android SDK: **`C:\Android\Sdk`** (cmdline-tools/latest, build-tools 36.0.0, cmake, ndk, platform-tools, platform 36) — `build-apk.ps1` expects exactly this path
- Gradle 9.3.1 (manual): `C:\Users\bhavy\.toolchain\gradle-9.3.1\bin\gradle.bat`
- Release keystore: `android/app/wallnut-release.keystore` (alias `wallnut`, passwords in `android/gradle.properties`)
- Gradle JVM memory raised to 4096m for the New Architecture release build
- Network note: adoptium.net is throttled here (~65 KB/s); use the Azul CDN or Google's dl.google.com (both >1 MB/s)
- **Latest APK: `wallnut-2026-10-07.apk` (74.5 MB, Pass 16: AI quick entry + Android widgets)** — warm build 4 m 13 s; package `com.wallnut.app`, versionCode 1, signed with the existing keystore so `adb install -r` updates in place and keeps app data (migration 0009 `widget_snapshots` applies on first launch). Verified with `aapt2`: 4 widget receivers + `home_screen` category + 30-minute updates + `wallnut://` scheme + Inter widget fonts. Note: `expo prebuild` clears `android/` — back up `android/app/wallnut-release.keystore` first and restore it before building.

---

## 10. CI/CD (GitHub Actions)

Branches: `main` is the release line, `development` is where work happens.
Merging `development` into `main` is what ships.

- **`.github/workflows/android-release.yml`** — builds the signed release APK and
  publishes it as a **GitHub Release** (tag `v<version>-b<run>`, APK
  `wallnut-<version>-b<run>.apk`). It runs **only when `main` changes** — i.e. when
  `development` is merged into `main` — plus manual `workflow_dispatch` runs
  (manual runs upload the APK as a workflow artifact without creating a release).
- **Versioning per build**: `versionCode` = workflow run number (unique, strictly
  increasing), `versionName` = `<app.json version>+b<run>` (e.g. `1.0.0+b42`).
  Implemented by `scripts/ci/set-version.mjs`, which runs before `expo prebuild`.
- **Signing**: CI uses the same release keystore as local builds, so
  `adb install -r` updates the installed app in place. Repo secrets
  (Settings → Secrets and variables → Actions): `WALLNUT_KEYSTORE_BASE64`
  (base64 of `android/app/wallnut-release.keystore`), `WALLNUT_STORE_PASSWORD`,
  `WALLNUT_KEY_ALIAS`, `WALLNUT_KEY_PASSWORD`. `scripts/ci/setup-signing.mjs`
  decodes the keystore, adds the `WALLNUT_*` properties + the 4096 m heap to
  `gradle.properties` and patches `app/build.gradle` exactly like
  `scripts/build-apk.ps1` does locally. To recreate the base64 value:
  `[Convert]::ToBase64String([IO.File]::ReadAllBytes('android/app/wallnut-release.keystore'))`.
- **`.github/workflows/ci.yml`** — typecheck + unit tests on every push to
  `development` and on PRs into `main`. Lint is deliberately not gated (the
  react-hooks v6 rules flag many pre-existing patterns — see open items).
- The runner reproduces the local toolchain: JDK 17 (Temurin), Android platform
  36, build-tools 36.0.0, NDK 27.1.12297006, cmake 3.22.1 — the versions pinned
  by `node_modules/react-native/gradle/libs.versions.toml`.
- Built APK files are gitignored (`*.apk`) — release assets live on the
  Releases page, not in the repo.
- **Verified end-to-end**: run #2 built and released
  [`v1.0.0-b2`](https://github.com/panchalbhavya2210/wallnut/releases/tag/v1.0.0-b2)
  (~16 min). The downloaded APK reports `versionCode=2`, `versionName=1.0.0+b2`,
  and its signer SHA-256 matches the local keystore exactly — so installed local
  builds update in place via `adb install -r`.
