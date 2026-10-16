# Wallnut — project status & living task list

> **Read this first.** This file is the handoff document for any new session
> (human or agent). Keep it updated as work lands. Last updated: 2026-10-16 (Pass 22: Home polish — account pills with balances + add-account + long-press actions, top tabs removed, gradient-blob backdrop, chart polish, long-press fixes; Pass 21: statement import P1 + Quick Actions + performance).

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
    import/[batchId].tsx   statement review: staged drafts → confirm/skip/edit/merchant memory → ledger
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
    schema.ts              34 tables + relations (money = integer minor units); ai_cache; widget_snapshots;
                           import_batches/import_drafts (statement staging); transactions.capture_source
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
  services/import/         statement import pipeline: sources → normalize → validate → local rules → dedupe → preview → commit
                           (`pipeline.ts` is pure and unit-tested; `staging.service.ts` persists previews as
                           `import_batches` + `import_drafts` — a file never writes to the ledger directly;
                           CSV stages today, OFX/QFX + PDF planned — §7 “Transaction Inbox”)
  services/inbox.service.ts Financial Inbox: ONE attention queue derived from review + recurring + upcoming + goals + shared (dismissals only)
  services/review.service.ts review queue (uncategorised / unreviewed / duplicate / large / broken transfer) + duplicate groups
  services/rules.service.ts  rules engine CRUD; reachability matching is pure in utils/rules.ts
  services/merchant.service.ts merchant stats + aliases; canonicalisation is pure in utils/merchant.ts
  screens/DataScreen.tsx   Import & export wizard (map → preview → dedupe → review → commit), backup/restore
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
* Navigation: bottom nav (Home · Transactions · + — create · Budgets · Insights) with the create action in the thumb zone; the destination drawer opens from the **menu button pinned top-right** (searchable destination index, net-worth summary, BETA badge); detail screens keep a back chevron. Long-press the menu button toggles privacy.
* Home dashboard: account scope selector (All accounts / one account — every balance + analytic follows the selection), 26 widgets (net worth with count-up, cash flow, spending, pace, savings-rate gauge, trends, categories, budgets, goals, debts, subscriptions, instalments, reminders, insights, money flow, recent, accounts…), drag-to-reorder editor, presets, per-widget period/size configuration.
* Charts: scrub gestures that don't scroll the page (scroll lock + activation/failure offsets, web `touchAction`), persistent tooltips, auto-baseline for balance/net-worth charts, smoother areas and end-point markers.
* AI MVP (DeepSeek, BYO key in Settings → AI & Intelligence): transaction categorization with accept/dismiss, Home AI insight card, Financial Intelligence assistant (deterministic engine answer first, AI explanation second), "Can I afford this?" maths + explanation, monthly-review summary, SQLite response cache with TTLs, privacy filter (none/anonymized/detailed), usage + estimated cost metering, graceful offline/disabled handling.
* Recurring: monthly schedules anchored to their day (the 31st skips February instead of drifting), manual schedules keep overdue occurrences visible ("due now"), custom cadence monthly-equivalent fixed, `anchor_day` migration backfills existing rows.
* Accounts: filled net-worth hero (assets/liabilities/spendable), grouped account cards with institution/type, card utilisation bars; **Accounts page and charts both rebuilt after user review**.
* Keyboard-safe sheets: bottom sheets lift with the soft keyboard (there was no keyboard handling before — popups with inputs were covered by the keyboard on Android).
* Material: `@expo/ui` Material You wallpaper palette on Android 12+ (no third-party module), stronger tonal filled surfaces, filled net-worth hero, material palette visibly restyles cards/inputs.
* Transactions: Records-style statement (period presets, week groups with subtotals, Σ strip, review badges, relative dates), search, tabs, advanced filters, swipe actions, multi-select bulk edit.
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
  - **AI Quick Entry** (`src/ai/commands/`): natural language → DeepSeek JSON → **strict `AiFinancialCommand` schema** → local name resolution → clarification questions → confirmation per setting → **existing services only**. The model never writes to the DB and never invents account/category/goal/person names; unknown names become questions (two accounts both called “Kotak Bank” → “Which account is ‘Kotak Bank’?” with balances as chips). Intents: CREATE_TRANSACTION / INCOME / TRANSFER / SHARED_EXPENSE / LOAN / LENDING / SETTLEMENT / RECURRING / GOAL_CONTRIBUTION / UNKNOWN. Confirmation modes: ALWAYS (full card) / SMART (one-tap card for simple, full for high-risk) / AUTO (trusted quick save with undo; transfers/debts/splits/large always confirm). Local answers never re-call the model; duplicate signature guard; privacy filter applies to context while the typed sentence is passed verbatim so large amounts survive sanitization. Entry points: FAB/bottom-nav “Ask Wallnut”, Financial Intelligence, widget Quick Add, `wallnut://quick-entry`. **Pass 20 adds bulk entry** — several movements in one message → one verification row each (see the Pass 20 bullet below). 29 unit tests in `tests/quick-entry.test.ts`.
  - **Android home-screen widgets** (`react-native-android-widget` 0.22.1): four providers — Snapshot (2×2 safe-to-spend + today), Balance (4×2 net worth/available/safe), QuickAdd (4×2 expense/income/transfer + Ask Wallnut), Upcoming (4×2 next recurring bills). Config plugin in `app.json`; custom entry `index.ts` registers the task handler then imports `expo-router/entry`; headless task handler; `WidgetDataService` (`widget_snapshots` table, migration 0009) built from the canonical services; debounced refresh on every db-revision/settings change + on app start + Android’s 30-minute `updatePeriodMillis`; deep links (`wallnut://home|quick-entry|calendar|settings/widgets`) via native `OPEN_URI`; light/dark variants following the active accent; Inter bundled for widgets; Settings → Widgets (enabled, show amounts, default widget, launcher pin prompt). Widgets are `home_screen` only — amounts never on the lock screen (enforced at build time, stated honestly in settings).
  - **19 accents** in Appearance (added red, neon pink/purple/green/cyan/orange, lime, teal, sky, gold, orange, coral) and **calmer button feedback** (shallower press, no release overshoot).

* **Pass 17 (Wallet-style Records + per-category month-on-month)**:
  - **Transactions rebuilt as a Records statement**: header search + overflow menu, period sheet (7D/30D/12W/6M/1Y — the filter sheet still provides custom range), a Σ total strip, statement groups (day/week/month, auto-resolved from the period) with week subtotals, circular category icons with a reviewed badge, name › account › italic note rows with relative dates (Today/Yesterday) and red/green signed amounts. Statement Σ and group subtotals come from SQL (`summarizeTransactions`, `getDailyTransactionTotals`) with the same filters as the list, so paging can never distort them; transfers are excluded from totals unless the Transfers tab is active.
  - **Per-category month-on-month**: new `/category-trends` page (6M/1Y, this cycle vs previous, grouped bars, per-category sparkline rows, change pills, top movers) with a **month dropdown** — the cycle label is tappable and lists the current cycle plus the 24 before it (a "This cycle" chip resets) so any past month can be compared against the one before it; a MONTH ON MONTH card on category detail, and a **Category Trends dashboard widget** (registry + Spending preset + `DEFAULT_WIDGETS`; auto-placed once after the donut via `dashboard.categoryTrendsPlaced`, mirroring the safe-to-spend pattern). Buckets respect the `monthStartDay` cycle (SQL dates shift back `monthStartDay − 1` days) and refunds net into the month they landed in.
  - **Demo data fixed** (`seed.service.ts`): randomized amounts were authored in rupees but written into paise fields (100× too small — "Rapido −₹1.50"); all corrected to rupee scale, the current month clamps to today so the ledger has **no future-dated rows**, and the demo economy was rebalanced for the corrected scale (₹60k salary, one monthly ATM withdrawal, card payment tracking actual card charges) so no account drifts absurdly negative.
  - **Tests**: 159 green (14 new `tests/records.test.ts` cases for grouping/subtotals/month-cycle buckets); `tsc --noEmit` clean.

* **Pass 18 (category detail custom range + MoM month dropdown)**:
  - **Custom period on category detail**: the period strip gains a **Custom** chip — a From/To `CustomRangeSheet` (quick chips: last 7/30/90 days, this year; defaults to the last 30 days) that overrides the preset until another chip is picked. Every section on the page (spend stats, pace, subcategory split, merchants, trend, transactions) follows the range; the MONTH ON MONTH card keeps its own cycle picker. Same contract as Analytics.
  - **Month dropdown on the MONTH ON MONTH card**: the cycle caption is now a tappable pill (shared `MonthCyclePicker` — extracted from `/category-trends`, which was refactored to use it) listing the current cycle + the 24 before it in a `PickerSheet`; picking a past cycle re-anchors the card via `getCategoryMonthlyTrends({ anchor })` — number, change ("vs May"), bars and the "Previous · May 2026" row all retarget — with a "This cycle" chip to reset.
  - **Analytics bug fix**: applying a custom range left `period` untouched, so the range memo kept ignoring `customRange` (header stayed on the preset, nothing changed). `onApply` now sets both.

* **Pass 19 (UI revamp — botanical light theme + Home/Transactions/Insights)**:
  - **Theme**: default is now **light + `botanical` accent** (deep green #245C3E family) with a gray-green canvas (#F5F7F5), white cards, charcoal text (#18231D) and muted gray (#68736C); `themeVersion: 3` in `settings.service.ts` migrates the old magenta/dark defaults once and never touches an explicit user choice. The dark palette was retinted to match (green-tinted neutrals). New `heroGradient` token (`theme/palette.ts`) drives the dark-tonal green hero card.
  - **Chrome**: shared `AppHeader` (brand or title + subtitle, search, filter, review bell, account avatar → drawer) and `TopTabs` (sentence-case primary tabs with an accent underline); `BottomNav` is Home · Transactions · + · Budgets · Insights; controls went pill-shaped (`Chip` filled-accent when selected, `Button` pill, circular list icon tiles 36 px); `SectionHeader` is sentence case.
  - **Home** (`(app)/index.tsx`): brand header → TopTabs (Overview/Accounts/Insights) → greeting line → compact account-scope chips → widgets, reordered as status → spending → activity. `NetWorthWidget` is now the hero (dark green gradient card, white type, privacy eye, `PeriodPill`, change pill, `onDark` chart, assets/liabilities footer); new **`quick_actions` widget** (Add expense / Add income / Transfer / Budgets with labels); `IncomeExpenseWidget` (two `FlowTile`s + mini bars), `CategoryBreakdownWidget` (top-3 + Others progress rows), `RecentTransactionsWidget` (circular icons, dividers, chevrons). New `DEFAULT_WIDGETS` order — `net_worth, quick_actions, income_expense, category_breakdown, recent_transactions` — with `migrateDashboardLayout` matching the legacy v1/v2 default layouts so existing dashboards upgrade once.
  - **Transactions**: pill period control (`PeriodPill` + total on the right, `CompactPeriodSheet` still owns the presets + grouping), pill tabs (All/Expenses/Income/Transfers, horizontally scrollable), scrollable white statement cards with hairline dividers, circular category icons, amount + time/date + chevron on the right, and group headers as "Today"/"Yesterday"/"Wed, 14 Oct"/"Week 42"/"October 2026" (day groups drop the Σ subtotal). `rowTimeLabel` added to `utils/records.ts`.
  - **Insights** (`(app)/analytics.tsx` rebuilt): four `TopTabs` — Spending · Income · Net worth · Trends — over a period row of `PeriodPill` (incl. custom range) + a 7D/1M/3M/1Y `SegmentedControl` (now supports `value={null}` so non-segment presets don't fake a selection). Spending = total-spending hero (big number, change pill with arrow, daily bar chart) + one-line insight banner ("You spent X% more… mainly due to higher …") + category card with an **Amount / %** toggle, share bars and an "Others" row + top merchants. Income = income hero + income-source breakdown (same toggle) + income-vs-expenses grouped bars + subscriptions. Net worth = net-worth hero with the 1-year trend + health gauges + accounts donut/list. Trends = what changed, cash flow, pace & daily, money flow, merchants, budgets.
  - **Budgets** header switched to `AppHeader` (accent "+" action round button) with the hint below; icon tiles circular; "THIS PERIOD" → "This period".
  - **Verification**: `tsc --noEmit` clean, 159 tests green, web export rebuilt; screenshots `home.png`, `transactions.png`, `insights.png` plus tab/scroll passes (`.expo/screenshots/`, throwaway scripts) and a full dark-mode pass — light `390×844` and dark both verified. Rebuild: **`npx expo export --platform web`** then reload; the export bakes the theme defaults, so an old bundle will still show the magenta/dark theme.

* **Pass 20 (bulk quick entry, drawer performance, calendar library, toast redesign)**:
  - **Bulk AI quick entry**: a message with several movements (`,` / `;` / newline) goes through the **list** prompt (`analyzeQuickEntryBatch`) and lands on a per-row verification screen; every row edits name/amount/category/date/account locally, `Save all` writes them through the existing services in order (`executeQuickEntryBatch`) with a single undo, and fragments the model excludes (loans, splits, subscriptions) can be pushed into the single-entry flow with "Enter separately". One movement collapses into the classic flow; a failed list parse falls back to the single parser.
  - **Drawer**: opens without re-querying the ledger or re-rendering the destination list (`useDrawerStatus`-gated net-worth query + memoized rows/options + `freezeOnBlur`).
  - **Calendars**: every date picker and the ledger calendar are `react-native-calendars` through `src/components/ui/calendar.tsx`.
  - **Toasts**: save feedback is a card with a tone icon, heading + summary, Undo pill and a countdown hairline; action toasts auto-dismiss too.
  - **Verification**: 165 tests green, `tsc` clean, lint clean on all touched files, web export rebuilt; screenshots `home-batch.png`, `budgets-pass20.png`, `drawer-open.png`, `toast-save.png`, `quick-entry-pass20.png`.

* **Pass 21 (statement import P1 + dashboard quick actions + performance)**:
  - **Statement import is now staged, not written** (`services/import/staging.service.ts`, migrations 0010): a CSV
    preview becomes an `import_batches` row plus `import_drafts` rows; **nothing reaches `transactions` from a
    file**. The wizard's primary action is now **Review N transactions** (stage → `/import/[batchId]`), with
    “Import without review” kept as the fast path. Invalid rows are counted but never staged; possible
    duplicates stay staged but are unchecked by default (“fingerprint matched date + amount + merchant”).
    The Data screen lists any pending review (“Statement review waiting”), and the Financial Inbox carries it
    as one Action-required item.
  - **Review screen** (`src/app/import/[batchId].tsx`): one card per draft (checkbox, merchant, raw statement
    text, date, category, amount), per-row edit sheet (merchant, type, date, category, note), skip, bulk
    “Add N transactions”, “Clear them” for duplicates, “Later” survives navigation/restarts, “Abandon import”
    deletes the staged rows. Confirming writes through the existing transaction service (balances included,
    rows land as reviewed) and **deletes the staged statement data** once every row is resolved — retention
    default, no opt-in needed. A batch fully resolved marks itself committed; a deep link falls back to the
    dashboard when there is no history to pop.
  - **Merchant memory** (`rememberMerchantForCategory`): a category correction can save “Always suggest this
    category” → a **suggest-mode rule** (`rules.mode`) + merchant alias. Suggest rules never apply on manual
    entry or imports — they preselect on the next import and say where the suggestion came from (“From
    ‘Remember Amazon’”). Apply-mode rules behave exactly as before; the rule engine gained
    `partitionRulesByMode` (pure, unit-tested).
  - **Capture source**: `transactions.capture_source` (`manual | csv | json | ofx | pdf | sms | notification |
    widget | ai`, backfilled `manual`) + `import_batch_id`. Records rows show an “Imported / From SMS / …”
    badge, and the filter sheet has a **Source** block (Imported / Manual entry / Needs review).
  - **Backup/privacy**: `import_batches`/`import_drafts` are wiped on restore but **excluded from backup
    files** (`VOLATILE_TABLES`) — raw statement text never travels in a backup.
  - **Dashboard quick actions** (`quick_actions` widget): Add expense · Add income · Transfer · **Import**
    (→ `/data`), exactly the reference layout. `ensureQuickActionsWidget()` places it immediately under the
    net-worth hero for dashboards that lack it (and moves it above Safe-to-spend when that card was
    auto-placed between them — the old Pass 11 order), once, without touching a deliberately rearranged
    dashboard. `ensureSafeToSpendWidget` now anchors after the quick actions when they exist.
  - **Performance pass** (the lag complaint): `useQuery` is **stale-while-revalidate** — a re-run (any write,
    any focus refresh) no longer flips `loading` back on, so cards never flash a spinner/layout jump for data
    that is already on screen; `notifyDbChanged` **coalesces writes within a tick** (a multi-write save used to
    re-run every subscriber once per write); the Home screen's widget tree is memoized against the widget rows
    + account scope and the minute clock moved into a `GreetingLine` child (it used to re-render every widget
    every minute); `LineChart`/`BarChart`/`DonutChart`/`Sparkline`/`FlowBars` are `React.memo`ized.
  - **Verification**: `tsc --noEmit` clean, **173 tests** green (8 new: rule partitioning, suggest-never-applies,
    suggestions never written silently, capture-source mapping, staged category precedence), lint clean on all
    touched files, web export rebuilt. `scripts/verify-statement.mjs` (19 checks) drives the whole flow in
    headless Chrome — fixture CSV → map → preview → stage → edit sheet + merchant memory → inbox item →
    commit → ledger badge → saved rule — and screenshots `home-pass21.png` (quick actions under the hero),
    `statement-review.png`, `statement-edit.png`, `inbox-statement.png`, `transactions-imported.png`,
    `rules-merchant-memory.png`.

* **Pass 22 (Home polish — scope bar, blobs, charts, long-press fixes)**:
  - **Top tabs removed from Home** (Overview / Accounts / Insights). The bottom nav + the drawer remain
    the navigation; the dashboard is a single scroll again.
  - **Account scope bar rebuilt** (`components/AccountScope.tsx`): one tinted pill per account showing its
    **live balance** (account colour as the dot/border, liabilities in red), an **All accounts** pill with the
    combined balance, and a dashed **Add account** pill that opens `AccountEditor` in place — add an account
    without leaving the dashboard. **Long-press any pill** for quick actions (Open account / Adjust balance /
    Edit account / Scope dashboard here) with haptic feedback; the sheet is also where "Scope dashboard here"
    lives, so the pills stay single-tap for scoping.
  - **Long-press was genuinely buggy on Records**: rows were wired to **two** long-press systems
    (`SwipeableRow`'s gesture-handler recognizer *and* the row's own `Pressable`), which double-fires or
    swallows the gesture on Android. The duplicate path is gone — the row's Pressable owns long-press
    (multi-select), the pan gesture only swipes. Bonus: the per-row Pan recognizer is now memoized, so a
    500-row list stops rebuilding one gesture object per row per render. The header menu's long-press
    privacy toggle now confirms with a toast ("Amounts hidden — long-press again to show").
  - **Glass/gradient theming** (`components/ui/backdrop.tsx`): soft radial **colour blobs** (accent /
    positive / tertiary) behind the top of Home — dark-mode aware, pointer-events off, one small SVG.
  - **Charts**: donut slices get **round caps + gaps** (reads as separate petals, tiny slices stay visible as
    dots); bars get **vertical gradient fills** (primary + secondary). LineChart already had the gradient area.
  - **Performance**: `renderWidget` caches each widget's parsed config per row (WeakMap) so the dashboard hot
    path stops re-parsing JSON; the Records `FlatList` is tuned (initial 8 / batch 8 / window 9, clipped
    subviews on Android) on top of Pass 21's stale-while-revalidate + coalesced bumps.
  - **Verification**: `tsc` clean, 173 tests green, web export rebuilt; screenshots `home-pass22.png`
    (tabs gone, balance pills, add-account), `scope-actions.png` (long-press sheet), `scope-add-account.png`
    (editor from Home), `analytics-via-nav.png` (gradient bars), `records-longpress.png` (multi-select via
    long-press). APK rebuilt: `wallnut-2026-10-16.apk`.

### Priorities (user-set, 2026-10-16)
1. **Transaction Inbox + statement import + merchant memory** — **P1 landed (Pass 21)**: staging tables,
   review screen, capture source, suggest-mode merchant memory. Remaining: OFX/QFX (cheap, same staging),
   statement reconciliation, PDF extraction spike, retention controls in Settings → Privacy. See §7.
2. **Flexible budget cycles** — periods that follow payday / statement cycles. See §7.
3. Then the rest of §7 in order.

### Known open items
1. **Device palette (Material You wallpaper colours)** — now powered by first-party `@expo/ui`
   (`getMaterialColors`, Android 12+; falls back honestly below that). Needs the Android build
   (works in Expo Go too); web/iOS report it unavailable. The import is guarded to the native
   bridge file only — `@expo/ui` throws if required on web.
2. Unit tests are in place and green (173 tests: money maths, accounting rules, budget maths,
   anchored recurring schedules, investments, duplicate detection, CSV import, date ranges,
   category tree, palette generation, AI privacy/hash/intents/affordability, quick-entry
   schema/resolution/confirmation + bulk-list parsing, statement staging semantics
   (apply vs suggest rules, never-write-suggestions, capture sources), inbox priorities,
   shared-expense splits/balances/items/settlements, records statement grouping/subtotals/month-cycle buckets).
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
8. `npx expo lint` currently fails with ~56 pre-existing errors (mostly the new
   `react-hooks/set-state-in-effect` rule in `theme.tsx`, `FilterSheet`, `CustomRangeSheet`,
   settings screens, plus a couple of unescaped apostrophes). None come from Pass 19 —
   `tsc --noEmit` and the 159 tests are the gate; a lint sweep is its own task.
9. Older screens still use the pre-Pass-19 visual language (uppercase `label` captions and
   back-chevron `ScreenHeader`): settings, reports, detail screens, composer, drawer. See the
   Pass 19 status map for the list.

### Explicitly out of scope for V1
Bank connectivity (no aggregators, no credentials, ever), cloud sync, multi-user,
payment initiation, market data, AI/NL search. **Statement import is in scope** —
file-based CSV/OFX/PDF statement reading is the #1 planned feature (§7 “Transaction
Inbox”); what stays out is any *aggregator* login. SMS/notification capture is a
best-effort convenience only (architecture ready in `src/services/sms/`), never the
only capture path. PDF/XLSX *report export* stays minimal (CSV is the supported
report path) — import and export are different problems.

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
| `/category/<id>` cannot be deep-linked in a verify run | category ids come from `createId` (random per boot) and rows navigate with `router.push`, so ids never appear as hrefs | click a row on `/category-trends` in the same browser session, then screenshot the detail page |
| Verify script clicks the wrong (hidden) control after navigating | the previous Stack screen stays mounted in the DOM with its own interactive copies; `document.querySelector` returns the hidden one first, and a "fall back to all matches" pill check can also mask the next screen's LoadingBlock | scope probes to the *visible* instance (bounding rect > 0), take the last match, and retry clicks that can race the refetch/LoadingBlock |
| Demo amounts 100× too small ("Rapido −₹1.50") | seed literals authored in rupees were written straight into paise fields | keep `_00` on intended-rupee literals in `seed.service.ts` (match the `round` step: `10_00` = nearest ₹10) |
| Theme revamp "doesn't apply" on reload | theme defaults live in the bundle **and** in stored settings; the stored settings win | ship defaults with a `themeVersion` bump (`settings.service.ts` currently 3) and migrate only the previous defaults, never an explicit user choice — and rebuild/reload the export (a dev server serves the old bundle) |
| Bottom-nav layout edits silently do nothing | `(app)/_layout.tsx` renders `BottomNav`, the destination list also feeds the drawer index | edit the destination array in one place (`BottomNav.tsx`) and keep `/analytics` labelled "Insights" so `TopTabs`/drawer/nav never disagree |
| Drawer gets slower the longer the app runs (Android APK) | `DrawerContent` held a `useQuery` that re-runs on **every** `useDbStore.revision` bump (any write anywhere), plus ~50 rows + the nav options were recreated on every drawer open/bump | gate the net-worth query on `useDrawerStatus()` and cache the last value in a ref, `React.memo` the destination rows, `useCallback` `drawerContent`/`screenLayout`, `useMemo` `screenOptions`, and set `freezeOnBlur: true` (the prop alone is enough — no `enableFreeze()` call needed; `DrawerView` destructures it from screen options and passes it to `react-native-screens`' `Screen`) |
| Custom calendar cells (`calendar.tsx`, `DatePickerSheet`, ledger calendar) | hand-rolled month grid | all date picking goes through `src/components/ui/calendar.tsx` (`react-native-calendars`, JS-only so no prebuild, but the APK must be rebuilt); its `dayComponent` receives `DayProps & { date?: DateData }` where `DayProps.date` is a `string`, so custom cells must accept `date?: DateData` and guard |
| Toast invisible / never dismissed | toasts render in the root layout **after** the `<Stack>`, so they paint above modals — but an `onAction` toast used to never auto-dismiss and thin bars were easy to miss | `ToastMessage` now always carries `durationMs` (base 3.4 s, undo 6.5 s, error 5.2 s) and renders a countdown line; pass `{ title }` to show a bold heading with the summary as the muted detail (`toast.undo('₹450 · Zomato', undo, { title: 'Saved' })`) |
| Bulk quick entry never triggers / re-asks the same split | `looksLikeList()` (`,`, `;`, newline) routes to the **list** prompt — a single movement that merely contains a comma (a people list, two items on one bill) must stay in the single flow | the list prompt is told never to split a single movement and to return non-plain fragments in `excluded`; `parseAiCommandList` drops unusable rows and fails with `empty` so the caller falls back to `analyzeQuickEntry`; the list cache slot is `mode: 'list'`, and `AI_PROMPT_VERSION` must be bumped whenever prompt text changes |
| Dashboard flashes spinners / every card rebuilds after any write | `useQuery` used to set `loading: true` at the start of every re-run, and `notifyDbChanged` bumped once per service write (multi-write saves re-ran every subscriber per write) | `useQuery` is stale-while-revalidate (keeps previous data; `loading` only before the first `resolved` result) and `notifyDbChanged` coalesces to one bump per tick — do not "fix" either back to eager loading |
| A screen stuck on its loading state after the data resolved | a query whose value is legitimately `null` (e.g. `getImportBatchBundle` for a missing batch) | `useQuery` tracks a `resolved` flag separately from `data` — `loading = !resolved && !error`; never infer "loading" from `data === null` |
| Revenue/expense analytics influenced by statement imports | an unconfirmed draft must never reach `transactions` | only `/import/[batchId]` (or the explicit “Import without review”) writes rows, through `insertImportedTransactions`; drafts live in `import_drafts` and are deleted when resolved or abandoned |
| Backup restore leaves stale statement drafts | staging tables are wiped by restore but excluded from backup files | `VOLATILE_TABLES` (`import_batches`, `import_drafts`) covers both: excluded from `createBackup`, still in `USER_DATA_TABLE` delete order |

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
| Import transactions from files (YNAB/Monarch-style) | **CSV + JSON done; PDF is the #1 next feature** (user brief 2026-10-16, §7 “Transaction Inbox”) — OFX/QFX follow; the differentiator is the review + merchant-memory loop around it, not the parser. |
| Multi-currency with live exchange rates | **Storage yes, rates no** — currencies are first-class in storage and formatting; there is no FX feed (offline-first). |
| Bank sync (15,000+ banks, PSD2), cloud sync, family sharing, AI/ML categorisation | **Declined for V1** — would require a backend, credentials or network calls, which contradicts the local-first promise. Deterministic rules replace the AI categorisation; **file-based statement import (CSV/OFX/PDF) is the planned next ingestion path, with SMS/notifications kept deliberately best-effort**. |
| Needs vs wants classification | **Declined** — not a Wallet feature, and tags already cover “Trip / Work / Family / Tax” without adding a second taxonomy to maintain. |

Design guidance applied: charts take their colour from the active palette
(`buildChartTokens`) with Material's primary/secondary/tertiary leading multi-series charts;
gauges and count-ups provide the “visual indicators” Wallet is known for; motion respects the
reduce-motion setting.

---

## 7. Next actions (priority order)

1. **Transaction Inbox + statement import + merchant memory** — the #1 next feature (user brief, 2026-10-16). Deliberately prioritised **above** notification/SMS capture: background capture rules vary per Android OEM and can never be the only path. Design, scope and open questions are in “Transaction Inbox + statement import (planned)” below.
2. **Flexible budget cycles** — budgets (and any period the app calls “this month”) should follow a real pay cycle or statement cycle, not just the calendar month (user brief, 2026-10-16). Scope in “Flexible budget cycles (planned)” below.
3. **Safe-to-Spend v2 + forecast warnings** (second brief phases C/D) — emergency reserve, credit-card obligations, confirmed expected income, low-balance runway warning.
4. Recurring editor fields (end date, reminder offsets, notes) and multi-day monthly schedules.
5. AI follow-ups: import-time batch categorization review, rules created from accepted corrections (this is where merchant memory plugs in), merchant→category alias memory.
6. Subscription intelligence (phase E): price-increase detection + a dedicated review screen (annualised summary + detection already exist).
7. Anomaly detection (phase I): merchant/category vs a 3-month average, paycheck detection.
8. Quick-entry follow-ups: on-device speech input (the composer relies on the keyboard mic today), a widget “recent transactions” provider, and per-widget configuration screens.
9. SMS ingestion (best-effort convenience only) — the Android native reader over `src/services/sms/`; it must never be the only capture path, and nothing fake ships before it exists.
10. PDF/XLSX **report export** templates (import is item 1 — export is a separate renderer problem).
11. Screenshot review at phone widths once Chrome viewport emulation is usable again (puppeteer/Chrome CDP mismatch — see §5).

> **Pass 16 APK — built (2026-10-07)**: `wallnut-2026-10-07.apk` (74.5 MB, warm build 4m 13s) — verified with `aapt2` to contain all four widget receivers (`Snapshot`, `Balance`, `QuickAdd`, `Upcoming` with labels), `WIDGET_CLICK` + `APPWIDGET_UPDATE` actions, `widgetCategory=home_screen`, `updatePeriodMillis=1800000`, the `wallnut://` deep-link scheme, and the bundled Inter fonts. A fresh APK is needed for Pass 19/20 (theme, calendars, drawer fix, bulk quick entry). Install with `adb install -r <file>.apk`, then add a widget from the launcher — widgets never work in Expo Go.

### Transaction Inbox + statement import (planned — user brief, 2026-10-16)

The user is locked out of aggregators by choice (“I don’t trust 3rd parties with my
banking login”), so their only path today is manual entry. The feature is **not a PDF
uploader** — it is a way to capture transactions Wallnut would otherwise miss, recover
the context behind purchases, and let the user decide what belongs in the ledger:

```
Import (bank statement / export file)  →  Review (staged drafts)  →  Confirm (write to ledger)
```

**Non-negotiables**

- **Staging, not writing.** Extraction never touches the ledger. Drafts live in their own
  tables/status; totals (dashboard, analytics, budgets, safe-to-spend, widgets) must never
  include an unconfirmed draft. The CSV wizard already behaves this way (map → preview →
  dedupe → review → commit) — every new source reuses the same pipeline
  (`src/services/import/pipeline.ts` is pure and unit-tested).
- **Review screen per draft**: date, the bank's raw description, best-effort merchant,
  amount, suggested category (from rules/aliases, explained as “from your saved rule”),
  an optional note prompt, plus split / mark-transfer / skip / **Later**. Confirm in bulk
  or one row at a time. “Later” must survive navigation and app restarts.
- **Duplicate detection warns, never assumes.** Same date + same amount can be two real
  purchases — mark “possible duplicate” with keep-both / skip, and reuse
  `buildFingerprints()` + `findDuplicateGroups()` rather than inventing a second matcher.
- **Merchant memory**: a correction on a reviewed row can be saved as a rule —
  *WHEN merchant matches X → THEN suggest category Y* (via `rules.service` +
  `utils/merchant.ts` aliases). Preselect + explain the source; never silently apply, and
  never auto-reuse a previous transaction's personal note. Add “apply silently” only as an
  explicit per-rule choice.
- **Reconciliation**: at the end of a batch (and from `/review`) compare the statement's
  opening/closing balance and totals against the account's ledger for the same window —
  “statement says ₹X, Wallnut says ₹Y → 2 rows missing, 1 possible duplicate”.
- **Capture status**: add an explicit `transactions.captureSource` (`manual | csv | ofx |
  pdf | sms | notification | widget | ai`) + `importBatchId`. Today nothing records where a
  row came from (`is_reviewed` + `fingerprint` exist; there is no origin column). Surface
  it as a row badge + filter (“Imported”, “Unreviewed”) so “find unreviewed imports” is a
  real query, not a guess.

**Formats — phased, honest about reliability**

| Phase | Format | Notes |
| --- | --- | --- |
| P1 | **CSV** + **review staging + merchant memory** | **Done (Pass 21)** — staging tables, `/import/[batchId]` review screen, capture source badge/filter, suggest-mode merchant memory, Inbox + Data entrances, drafts deleted on resolution and excluded from backups. |
| P2 | **PDF statement** | Picking is solved (`expo-document-picker` + `expo-file-system`, both already used by the import wizard/composer). **First task is a spike**: `pdfjs-dist` under Hermes (needs DOM shims and a worker strategy) vs a native text-extraction module (requires prebuild + a config plugin). Text-based statements then get line/column heuristics + a “confirm the columns” step like the CSV wizard, and a **saved per-bank template** once a layout is confirmed. Scanned/image PDFs and password-protected files must fail with a clear “not supported yet / unlock it yourself first” state — never a fake success. **Never persist the PDF or its password**: read from the cache copy, delete after extraction, ask for passwords per import and discard immediately. |
| P3 | **OFX / QFX** | Structured and easy to validate — cheap now the staging/review layer exists (drafts already carry `ofx` as a source). QIF only if asked. |
| later | XLSX | Reuse the CSV path with a spreadsheet reader; no priority. |

**Security & retention (design the storage layer before the uploader)**

- Payment statements are the most sensitive data the app will ever hold.
- Temporary import vault: keep the original file only while extraction/review runs; delete
  on commit **by default**, with an explicit “keep an encrypted copy” opt-in (and a
  “delete everything from this import” action).
- No statement content, account numbers or raw descriptions in diagnostic logs; review
  backup/restore behaviour for drafts (drafts should not survive a wipe silently).
  **Pass 21:** `import_batches`/`import_drafts` are cleared by restore/wipe but deliberately
  excluded from backup files (`VOLATILE_TABLES` in `db/tables.ts`), and resolved drafts are
  deleted the moment every row is confirmed or skipped.
- Honest encryption statement: today the SQLite file is not encrypted; before shipping
  PDF import, investigate `expo-sqlite` SQLCipher support + `expo-secure-store` for the key,
  or keep drafts file-only in the app cache with immediate deletion. Either way, Settings →
  Privacy must state exactly what is stored and for how long.
- Processing stays on-device (local-first promise). If a cloud OCR/AI step is ever offered,
  it must be opt-in, clearly labelled, and off by default.

**Existing pieces to build on**: `services/import/` (sources/normalize/validate/rules/dedupe/staging),
`screens/DataScreen.tsx` (wizard + backup/restore), `services/review.service.ts` +
`services/inbox.service.ts` + `/review` + `/inbox` (attention queue already lives here),
`utils/rules.ts` + `services/rules.service.ts` (apply + suggest modes), `utils/merchant.ts` +
`services/merchant.service.ts`, `utils/inbox.ts` priorities, `transactions.fingerprint` /
`is_reviewed` / `capture_source` / `import_batch_id`, `/import/[batchId]` review screen.

**Missing**: a PDF text extractor + per-bank templates, statement reconciliation, retention
controls in Settings → Privacy, split / mark-transfer actions inside the review sheet
(the composer covers splits afterwards), and OFX/QFX parsing over the same staging layer.

**Work breakdown (in order — each slice ships and verifies on its own)**

1. ~~`transactions.captureSource` + `importBatchId`~~ — **done (Pass 21)**: migration 0010,
   backup table list, Records badge, Source filter (Imported / Manual entry / Needs review).
2. ~~`import_batches` + `import_drafts` + `staging.service.ts`~~ — **done (Pass 21)**: stage a
   preview, list/resume batches, update/skip/confirm drafts, confirm bulk, abandon; pure
   semantics (draft → row, suggestions never applied) unit-tested.
3. ~~Review screen (`/import/[batchId]`)~~ — **done (Pass 21)**: cards, per-row edit sheet,
   skip, bulk confirm, duplicate handling (“Clear them”, auto-skipped on bulk confirm),
   **Later**, abandon, progress “N of M reviewed”, Inbox + Data entrances. Split / mark
   transfer from the review sheet remain for a later slice.
4. ~~Merchant memory~~ — **done (Pass 21)**: “Always suggest this category” writes a
   suggest-mode rule + merchant alias; imports preselect it and explain the source
   (“From ‘Remember Amazon’”), nothing applies silently. An explicit per-rule “apply
   silently” switch in the rules editor is still to do.
5. Reconciliation card: statement opening/closing balance + totals vs the account's ledger
   for the same window (pure comparator in `utils/`, service reads the window).
6. PDF: extraction spike (pdfjs vs native) → generic text-line parser + saved per-bank
   templates → password/unsupported states → staged review (same screens as P1).
7. OFX/QFX parser over the same staging layer.
8. Settings → Privacy: retention controls (“delete originals after import” default on,
   “keep an encrypted copy” opt-in) and “delete everything from this import”. (Pass 21
   already deletes staged drafts on resolution/abandon and keeps them out of backups —
   the visible controls are still to come.)

### Flexible budget cycles (planned — user brief, 2026-10-16)

Problem stated by the user: “Most budgets are based on a per calendar month cycle. But
depending on how I'm paid each month, I can easily end up in the red until the end of the
month.” The fix is to make the **cycle** a first-class, user-owned object instead of the
single global `monthStartDay` integer.

**Scope**

1. **Cycle model** (`settings.finance`): a list of named cycles —
   `{ id, name, kind: 'month_day' | 'payday' | 'statement', anchorDay?, accountId?, payCadence? }`
   plus `activeCycleId`. `month_day` covers “starts on the 25th” (the existing
   `monthStartDay`, migrated into a default cycle named “Monthly”), `payday` anchors to the
   salary/income deposit day (detected from history, user-confirmable, deterministic
   fallback to `anchorDay`), `statement` mirrors a credit-card account's `statementDay`.
2. **Every “this month” follows the active cycle**: budget progress/pace/rollover, safe-to-spend,
   Home period pills, analytics/insights/reports, category month-on-month, widgets
   (`widgets/snapshot.ts` reads `settings.general.monthStartDay` today), and period labels
   (“25 Sep – 24 Oct”, not “October”).
3. **Per-budget override (optional)**: a budget may pin its own cycle (e.g. the card budget
   follows the statement cycle) — default is the active cycle.
4. **Safety rails**: cycles never change historical bucket boundaries retroactively for
   *past* periods (a cycle change takes effect from the current period forward); label must
   always show the concrete range; a sanity check rejects anchors that would create a
   2-day or 40-day period.

**Implementation notes**: `utils/date.ts` already has `startOfCycle` / `endOfCycle` /
`getPeriodRange(..., { monthStartDay })` and `monthCycleBuckets` — the work is to pass a
cycle *object* (anchor + kind + resolved start) through the services instead of a bare
number, and to add a resolver that maps “now + cycle” → `{ start, end, label }` (pure +
unit-testable). `budgets.period` is `weekly | monthly | yearly | custom`; add
`cycleId?: string | null` and a migration. `accounts.statementDay` already exists for the
card preset. Verification: unit tests for the resolver (incl. payday drift and Feb 28/29),
then screenshots of Budgets + Home with a 25th-anchored cycle showing the right labels and
totals.

**Work breakdown**: (a) pure cycle resolver + tests (`utils/date.ts` / `utils/cycle.ts`) →
(b) settings model + migration (`monthStartDay` → default cycle, Settings → Finance UI) →
(c) thread the resolved cycle through budgets/safe-to-spend/analytics/insights/widgets and
the period labels, with a per-budget override chip in the budget editor.

### Feature roadmap — status map (user's 23-point brief)

| # | Feature | Status |
| --- | --- | --- |
| 2 | Credit cards own system | **Partial** — limit/available/utilisation, statement + due days, min payment in the editor; still to do: statement panel + min/full due surfaced on the card, one-tap "Pay card" (bank → card transfer, never an expense) |
| 3 | Safe-to-spend flagship | **Partial** — per-budget safe-to-spend exists; global flagship (income − bills − savings − commitments, per-day) still to do |
| 4 | Net worth understands everything + monthly history | **Mostly done** — accounts (+flags) + receivables − payables across every screen and the trend; month table still to do |
| 5 | Statement import | **Partial — PDF/OFX is the #1 next feature (§7 “Transaction Inbox”)** — CSV/JSON wizard live (map → preview → dedupe → review → commit); next: staged drafts, review screen, merchant memory, reconciliation, then PDF (on-device text extraction) and OFX/QFX |
| 6 | SMS transaction detection | **Architecture ready** (`src/services/sms/`); native Android receiver + tri-state setting still to do — **best-effort convenience only, deliberately behind file-based import** |
| 7 | Rules engine | **Done** (rules + editor). Advanced AND/OR conditions are future |
| 8 | Recurring detection | **Done** — `detectRecurringCandidates()` finds monthly patterns from history; confirmed candidates become manual-confirmation schedules (Inbox + Recurring screen). Multi-day monthly schedules still to do |
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
| 19 | Powerful search | **Mostly done** — search covers merchant, description, notes, reference, category, account, transfer account and tags; NL search will ride on the AI assistant |
| 20 | Export / backup | **Mostly done** — CSV/JSON export + restore (all 23 tables, rollback-safe); Excel/PDF export stays minimal by design (CSV is the supported report path — import is the priority), automatic local backup to do |
| 21 | App lock | **Done (Pass 13)** — biometrics (native) + salted-hash PIN fallback + auto-lock timeout + Lock now, enforced by the root layout |
| 22 | Privacy mode | **Done** — `security.hideAmounts` masks every amount through `useMoney().format`; eye on the Home hero + long-press the header avatar toggles it |
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

### Pass 19 — visual design brief (finance-app reference) — status map

| Brief item | Status |
| --- | --- |
| Green brand identity, light gray-green canvas, white surfaces | **Done** — `botanical` accent + light palette defaults (`themeVersion: 3`) |
| Home hierarchy: status → spending → activity; no decorative graphics, no oversized empty cards | **Done** — default widget order `net_worth → quick_actions → income_expense → category_breakdown → recent_transactions`; hero card is the only filled/gradient surface |
| Quick actions with labels (Add expense / income / Transfer / Budgets) | **Done** — `quick_actions` widget (also in the widget library for custom dashboards) |
| Income vs expense comparison + top-3 categories with progress bars + "View all" | **Done** — `IncomeExpenseWidget` FlowTiles, `CategoryBreakdownWidget` top-3 + Others |
| Transactions: merchant/amount emphasis, quiet metadata, day groups, pill tabs, circular icons | **Done** — statement cards, `rowTimeLabel`, pill tabs (All/Expenses/Income/Transfers), circular icon tiles |
| Insights: total spending + period filters + category chart, Amount/Percentage toggle, insight banner | **Done** — Spending tab (`analytics.tsx` rebuilt); Income/Net worth/Trends host the older sections |
| Bottom nav Home · Transactions · + · Budgets · Insights | **Done** — `BottomNav.tsx`; drawer moved to the header avatar |
| Never signal money direction by colour alone | **Done** — `MoneyText` signs, change pills all carry an arrow, `+`/`−` on deltas |
| Still to restyle (older pattern: uppercase `label` captions, back-chevron `ScreenHeader`) | Settings pages, reports, detail screens (category/merchant/account/budget detail), composer, `/review`, drawer — functional but not yet sentence-cased/`AppHeader`-ised |
| Still to check visually | Narrow-width (320 px) wrap on the Insights period row; RTL; tablets |

### Second-phase brief (shared expenses → intelligence) — status map

| Phase | Feature | Status |
| --- | --- | --- |
| A | Shared expenses / Splitwise-style | **Done (Pass 15)** — groups, dynamic line items, multiple payers per bill, equal/exact/%/shares, exact member balances + fewest-transfer settlement suggestions, settlements between any members, partial settlements + undo, Money Owed + net worth merge, composer "Shared" mode, quiet opt-in reminders; verified end-to-end (`verify-shared` + `verify-trip`) |
| B | Financial Inbox | **Done** — `/inbox` is one attention queue (urgent / action / suggestion / info) over the review queue + recurring candidates + upcoming + goals + shared balances, with dismiss/snooze (`utils/inbox.ts`, `inbox.service.ts`, `verify-inbox.mjs`); the review queue already flags duplicate / uncategorised / unreviewed / large / broken-transfer rows. **Extension planned:** statement-import drafts report into this same queue (§7 “Transaction Inbox”) instead of a parallel surface |
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
>
> Import rules (added 2026-10-16, §7 “Transaction Inbox”): a file never writes to the
> ledger — drafts stay staged until the user confirms; unreviewed drafts never count in
> spending, budgets, safe-to-spend or widgets; duplicate detection warns instead of
> assuming; learned rules only *suggest* unless the user opts into auto-apply; statement
> files and passwords are transient by default and never logged.


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

- **Pass 17 — Wallet-style Records + per-category month-on-month**:
  - **Records statement** (`src/app/(app)/transactions.tsx` rewritten to the Wallet brief): header search + overflow menu, "LAST 30 DAYS"-style period strip with a Σ total, statement groups with subtotals (`WEEK 42`…), rows with circular category icons, reviewed badge, name › account › italic note, red/green amounts and relative dates; period sheet (7D/30D/12W/6M/1Y) and a view-options sheet; search, tabs, advanced filters, swipe actions, multi-select bulk edit and pagination all kept. Grouping resolves from the period via `utils/records.ts` (`resolveRecordsGrouping`: day/week/month); the Σ strip and subtotals come from `summarizeTransactions` / `getDailyTransactionTotals` with the same filters as the list (paging-proof) and exclude transfers unless the Transfers tab is active.
  - **Month-on-month per category**: `/category-trends` page (6M/1Y toggle, total + change card, grouped `BarChart` this-cycle-vs-previous, per-category rows with sparkline and change pill, top movers) with a **month dropdown** — the cycle label opens a `PickerSheet` of the current cycle + the 24 before it; picking a past month re-anchors the whole page (window, previous-cycle card, chart legend "SEP VS AUG") via the service's `anchor` option, and a "This cycle" chip appears to reset; MONTH ON MONTH card on `/category/[id]`, and the `category_monthly` dashboard widget (registry entry, Spending preset, `DEFAULT_WIDGETS`, one-time auto-placement after the donut via `dashboard.categoryTrendsPlaced`). Single source: `getCategoryMonthlyTrends` (`analytics.service.ts`); month buckets shift dates back `monthStartDay − 1` days to respect the user's cycle; refunds net into the month they landed in.
  - **Demo seed corrected** (`seed.service.ts`): randomized ranges were authored in rupees but written into paise fields (100× slips — "Rapido −₹1.50", "More Retail −₹11.90") — fixed to rupee scale; `dayIn` clamps the current month to today, so no future-dated rows (the old `continue` was dead code); the economy was rebalanced for the corrected scale (salary ₹60k, one monthly ATM withdrawal, card payment estimate ₹12–24k vs actual card charges) so Kotak stays ~₹80k with a realistic credit-card balance instead of a −₹1L bank balance.
  - **Verification**: 159 tests green (14 new in `tests/records.test.ts`), `tsc` clean, web export rebuilt; screenshots `records.png`, `trends.png`, `category-detail.png`, `home.png` (widget), `widgets.png` (library), plus the month dropdown flow captured in `category-trends-month-picker.png` / `category-trends-september.png` (open → pick September → "This cycle" resets).

- **Pass 18 — custom range on category detail + shared month picker**:
  - The category page's period strip gains a **Custom** chip wired to `CustomRangeSheet` (`onApply` sets the range and `period='custom'`); the detail page's MONTH ON MONTH card now uses the shared `MonthCyclePicker` (extracted from `/category-trends`, which was refactored onto it) with the "Previous · <month>" row naming the cycle. Side fix: Analytics' `onApply` never set `period='custom'`, so applied ranges were inert — fixed and screenshotted.
  - Dead code dropped from `category/[id].tsx` (unused `previous`/`change` + `Button`/`Chip` imports).
  - **Verification**: throwaway puppeteer flow — trends → click Food & Dining → open the *visible* pill → pick June 2026 (`JUNE 2026` + "vs May" + bars ending June) → "This cycle" resets → Custom chip → apply last-30-days (caption "September 2026 17 → October 2026 16 · edit", SPENT ₹13,770 → ₹20,960) → Analytics Custom → apply (header "September 2026 → October 2026", "previous custom period"). Screenshots: `category-detail-june.png`, `category-detail-custom-sheet.png`, `category-detail-custom.png`, `analytics-custom.png`. 159 tests green, `tsc` clean, export rebuilt.

- **Pass 20 — bulk quick entry, drawer performance, real calendar, receipts-grade toasts**:
  - **Multi-transaction quick entry**: a message with `,`, `;` or a newline runs through `analyzeQuickEntryBatch` (new LIST prompt + `parseAiCommandList` in `src/ai/commands/schema.ts`; same `runAiFeature` cache with `mode: 'list'`). The verification screen (`quick-entry.tsx` phase `'batch'`, rows from `src/components/QuickEntryBatchRow.tsx`) edits name/amount/category/date/account(s) per row via the existing `PickerSheet`/`DatePickerSheet`/`FormSheet` sheets — all local, no second model call — and `Save all` writes every row through `confirmQuickEntryBatch` → `executeQuickEntryBatch`, which stops on the first failure and hands back one undo that reverses the saved rows. Rows that need something bulk entry cannot ask for (loan/split/schedule, missing account) are blocked with an inline reason until the user fixes or deletes them; the model's `excluded` fragments (loans, splits, subscriptions) get an "Enter separately" button that pushes a second quick-entry instance with `?q=` and the forced single-sentence path. One parsed movement with nothing excluded collapses into the classic question → confirm flow, and a list that fails to parse falls back to the single parser, so nothing typed is ever dropped.
  - **Drawer open performance (Android)**: `DrawerContent`'s net-worth `useQuery` now runs only while the drawer is open (`useDrawerStatus`, last value cached in a ref) instead of on every DB revision; destination rows are `React.memo`; `drawerContent`/`screenLayout` are `useCallback`-stable, `screenOptions` is `useMemo`-stable and gains `freezeOnBlur: true` so the two background scenes stop re-rendering during the open animation.
  - **Calendars**: `react-native-calendars` replaces every hand-rolled grid through one wrapper, `src/components/ui/calendar.tsx` (`AppCalendar`, `PickerDayCell`); `DatePickerSheet` keeps its Today/Yesterday/Tomorrow chips and optional `minDate`/`maxDate`, and `src/app/calendar.tsx` rebuilds the ledger month around `LedgerDayCell` (day totals, scheduled markers, selected-day card).
  - **Header / layout**: `HeaderMenuButton` is pinned top-right in `AppHeader` (long-press toggles privacy), and the new `HeaderScrollScreen` keeps header + tabs fixed while content scrolls — Home, Analytics and Budgets are converted (Budgets' `ScreenHint` now sits in the pinned header).
  - **Toast redesigned**: save feedback is a card — tone-tinted icon badge, bold heading with the muted summary under it (`toast.undo('₹450 · Zomato', …, { title: 'Saved' })`, `transaction/new.tsx` uses `Expense saved` / `Transfer saved` + amount · merchant), an Undo pill, and a countdown hairline; *every* toast auto-dismisses now (undo 6.5 s, error 5.2 s, base 3.4 s) instead of action toasts sticking around forever.
  - **Verification**: 165 tests green (6 new: list parsing, bad-entry dropping, `MAX_COMMANDS_PER_MESSAGE` cap, `empty`/`not_an_object` failures, `batchRowIssue`/`isBatchableIntent`), `tsc --noEmit` clean, `expo lint` clean on every touched file, web export rebuilt. Screenshots: `home-batch.png` (home + pinned menu button), `budgets-pass20.png` (fixed header while scrolling), `drawer-open.png` (drawer opened through a throwaway puppeteer click — net worth fetched on open, no console errors), `toast-save.png` (new save toast inside the composer modal), `quick-entry-pass20.png` (disabled state — the AI needs a key to exercise the batch screen).
  - **Still needs a keyed device run**: the batch verification screen and the undo toast can only be exercised with an AI key configured (Settings → AI & Automation); the parse/execute layer is covered by the unit tests.

- **Pass 19 — UI revamp: botanical light theme + Home/Transactions/Insights**:
  - **Tokens**: `src/theme/colors.ts` gains the `botanical` accent and a gray-green light palette plus a retinted dark palette; `heroGradient(base, mode)` in `src/theme/palette.ts` (exposed as `theme.heroGradient`) paints the hero cards. Defaults in `settings.service.ts` are `theme: 'light'`, `accent: 'botanical'`, with `themeVersion: 3` so the migration rewrites only the old defaults (dark/magenta) and preserves explicit choices.
  - **Shared chrome**: `src/components/AppHeader.tsx` (`AppHeader`, `HeaderBell`, `AccountAvatar`, `TopTabs`, `RoundIconButton`) — brand/title + subtitle, search/filter actions, review bell, avatar (opens drawer; long-press toggles privacy). `BottomNav` = Home · Transactions · + · Budgets · Insights. `Chip`/`Button` pill-shaped, `ListRow` icon tiles circular, `SectionHeader` sentence case.
  - **Home**: `NetWorthWidget` rewritten as the hero (gradient, white type, `PeriodPill`, change pill, `onDark` chart, assets/liabilities footer), **new `quick_actions` widget** (`QuickActionsWidget` + registry entry + `DEFAULT_WIDGETS`), `IncomeExpenseWidget` (FlowTile + MiniBars), `CategoryBreakdownWidget` (top-3 + Others), `RecentTransactionsWidget` restyled; `migrateDashboardLayout` recognises the legacy v1/v2 default orders. `index.tsx` assembled as AppHeader → TopTabs → greeting → scope chips → widgets → AI insight → "Customise dashboard".
  - **Transactions**: header/period/tabs/rows restyled as described in §4; period strip is now `PeriodPill` (new `onRequestOpen` prop lets a screen delegate to a richer sheet — `CompactPeriodSheet` keeps the presets + grouping switch), rows live in white statement cards with hairline dividers, right side shows amount + `rowTimeLabel`/`rowDateLabel` + chevron, and the overflow round button opens the view-options sheet (grouping, statement groups, icons, filters).
  - **Insights**: full `analytics.tsx` rebuild into Spending/Income/Net worth/Trends with the hero cards, insight banner, Amount/% category toggle and the redistributed older sections. `getCategoryBreakdown({ kind: 'income' })` powers the income sources card.
  - **Verification**: 159 tests green (records label expectations updated), `tsc --noEmit` clean, `npx expo export --platform web` rebuilt, screenshots `home.png` / `transactions.png` / `insights.png` (light 390×844) plus tab + scroll + dark-mode passes via throwaway puppeteer scripts in `.expo/verify/` (deleted after use). The 20 MB `dist/` swap is enough; Metro must be restarted for a dev-server run because the theme defaults are baked into the bundle.

- **Pass 21 — statement import P1, dashboard quick actions, performance**:
  - **Import (bank statement / export file) → Review (staged drafts) → Confirm (write to ledger)** is now the
    real flow. Migration 0010 adds `import_batches` + `import_drafts` and `transactions.capture_source`
    (backfilled `manual`) + `import_batch_id`. `services/import/staging.service.ts` stages a preview, lists
    pending batches, edits/skips/confirms drafts (bulk and single), abandons a batch, counts pending rows for
    badges, and owns merchant memory (`rememberMerchantForCategory`). Rows are written only through
    `insertImportedTransactions` (balances included) and land as reviewed; a batch fully resolved marks itself
    committed and **deletes its draft copies** (raw statement text). Backups exclude the staging tables.
  - **Rules gained a mode** (`rules.mode: apply | suggest`, existing rules stay `apply`): suggest rules (merchant
    memory) never run on manual entry or in the import writer — they preselect and explain (“From ‘Remember
    Amazon’”) on the review screen, and an applied category/rule always wins. `partitionRulesByMode` is pure and
    unit-tested; `loadEnabledRules(mode)` defaults to `apply` so nothing can silently apply a suggestion.
  - **`/import/[batchId]` review screen**: draft cards (checkbox, merchant, raw statement line, date, category,
    amount, duplicate chip), per-row edit sheet (merchant/type/date/category/note + “Always suggest this
    category”), skip, “Clear them” for duplicates, bulk “Add N transactions” (auto-skips unchecked duplicates),
    progress “N of M reviewed · nothing is in your ledger yet”, **Later**, abandon (deletes the batch), and a
    dashboard fallback when a deep link has no history. The Data wizard’s primary action stages + replaces into
    the review (“Review N transactions”), “Import without review” stays as the fast path; the Data screen and
    the Financial Inbox both surface pending reviews.
  - **Records**: imported rows carry a source badge (“Imported”, “From SMS”, …) and the filter sheet gained a
    **Source** block (Imported / Manual entry / Needs review). `TransactionFilters.importedOnly` /
    `manualOnly` are real SQL clauses.
  - **Dashboard quick actions**: the `quick_actions` widget is now Add expense · Add income · Transfer ·
    **Import**; `ensureQuickActionsWidget()` (one-time, respects deliberate layouts) puts it directly under the
    hero and above Safe-to-spend, and `ensureSafeToSpendWidget` anchors after it when present.
  - **Performance**: stale-while-revalidate `useQuery` (no loading flicker on writes/focus refresh, `null`
    still a real result via a `resolved` flag), coalesced `notifyDbChanged` (one revision bump per tick),
    memoized Home widget tree + `GreetingLine` clock, memoized chart components.
  - **Verification**: `tsc --noEmit` clean, 173 tests (8 new), lint clean on touched files, web export rebuilt;
    `scripts/verify-statement.mjs` (17 checks) + screenshots (`home-pass21`, `statement-review`,
    `statement-edit`, `inbox-statement`, `transactions-imported`, `transactions-imported-badge`).
  - **Still needs a device pass**: nothing here is native-only, but the APK predates Pass 19/20/21 — rebuild
    (`scripts/build-apk.ps1`) before judging animations/scroll on the phone.

- **Pass 22 — Home polish: scope bar, blobs, charts, long-press fixes**:
  - Removed the Home top tabs; rebuilt the account scope bar (balance per pill, account-coloured, All-accounts
    total, in-place Add account, long-press quick actions with haptics); added the `GradientBlobs` backdrop;
    donut round caps/gaps + gradient bars; fixed the double long-press wiring on Records rows (+ memoized the
    per-row pan gesture, tuned the FlatList); cached widget config parsing; header menu privacy long-press now
    toasts. Full detail in §4 and §8 (Pass 21/22 entries). Screenshots: `home-pass22`, `scope-actions`,
    `scope-add-account`, `analytics-via-nav`, `records-longpress`.

### Verification commands
`npm run typecheck` · `npm test` · `npx expo export --platform web` · `node scripts/serve-web.mjs 8081` · `node scripts/verify-web.mjs http://localhost:8081 home 390 844 "Assets"` · `node scripts/verify-statement.mjs http://localhost:8081` · `node scripts/verify-web.mjs http://localhost:8081/quick-entry quick-entry 390 844 "Quick Entry"` · `node scripts/verify-web.mjs http://localhost:8081/settings/widgets settings-widgets 390 844 "Widgets enabled"` · `node scripts/capture-screens.mjs http://localhost:8081 390 844` · `node scripts/verify-lock.mjs http://localhost:8081` · `node scripts/verify-shopping.mjs http://localhost:8081` · `node scripts/verify-shared.mjs http://localhost:8081` · `node scripts/verify-trip.mjs http://localhost:8081` · `node scripts/verify-inbox.mjs http://localhost:8081` · `node scripts/verify-web.mjs http://localhost:8081/transactions transactions 390 844 "Transactions"` · `node scripts/verify-web.mjs http://localhost:8081/analytics insights 390 844 "Total spending"` · `node scripts/verify-web.mjs http://localhost:8081/category-trends trends 390 844 "MONTH ON MONTH"` · `node scripts/verify-web.mjs http://localhost:8081/settings/dashboard widgets 390 844 "Widgets"`

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
- **Latest APK: `wallnut-2026-10-07.apk` (74.5 MB, Pass 16: AI quick entry + Android widgets)** — warm build 4 m 13 s; package `com.wallnut.app`, versionCode 1, signed with the existing keystore so `adb install -r` updates in place and keeps app data (migration 0009 `widget_snapshots` applies on first launch). Verified with `aapt2`: 4 widget receivers + `home_screen` category + 30-minute updates + `wallnut://` scheme + Inter widget fonts. Note: `expo prebuild` clears `android/` — back up `android/app/wallnut-release.keystore` first and restore it before building. **Passes 17–21 are JS-only, but the release embeds the bundle at build time — rebuild (`scripts/build-apk.ps1`) before judging the new theme/statement-import/perf work on the phone (migration 0010 applies on first launch).**

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
