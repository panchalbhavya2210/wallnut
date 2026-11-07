// Headless regression check for the app's sheets/modals.
//
//   node scripts/verify-modals.mjs <url>
//
// Exercises the exact flows that were broken on Android before the sheets moved
// from React Native's native Modal to the portal-based bottom sheet engine:
//   plus button → quick-add sheet
//   filter sheet → nested account picker → nested date picker → apply
//   plus button → expense composer navigation
//
// It writes screenshots to screenshots/modal-*.png and fails (exit 1) if any
// sheet does not open, does not stack, or does not return to its parent.
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const base = (process.argv[2] ?? 'http://localhost:8081').replace(/\/$/, '');
const width = 420;
const height = 900;

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const executablePath = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
if (!executablePath) {
  console.error('No Chrome/Edge found.');
  process.exit(1);
}

mkdirSync(join(root, 'screenshots'), { recursive: true });

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: [`--window-size=${width},${height}`, '--disable-gpu', '--no-first-run', '--disable-extensions'],
  defaultViewport: null,
});

const page = await browser.newPage();
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

const results = [];
function check(label, pass, detail = '') {
  results.push({ label, pass, detail });
  console.log(`${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function bodyText() {
  return page.evaluate(() => document.body.innerText || '');
}

async function waitForText(text, timeout = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if ((await bodyText()).includes(text)) return true;
    await sleep(150);
  }
  return false;
}

async function waitForTextGone(text, timeout = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (!(await bodyText()).includes(text)) return true;
    await sleep(150);
  }
  return false;
}

/** Clicks the top-most visible element with an accessible label. */
async function clickLabel(label, { last = true } = {}) {
  const clicked = await page.evaluate(
    (label, last) => {
      const nodes = Array.from(document.querySelectorAll(`[aria-label="${CSS.escape(label)}"]`)).filter((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      });
      const target = last ? nodes[nodes.length - 1] : nodes[0];
      if (!target) return false;
      target.scrollIntoView({ block: 'center' });
      target.click();
      return true;
    },
    label,
    last,
  );
  await sleep(450);
  return clicked;
}

/** Clicks the deepest visible element whose trimmed text matches, bubbling to its button ancestor. */
async function clickText(text, { last = true } = {}) {
  const clicked = await page.evaluate(
    (text, last) => {
      const all = Array.from(document.querySelectorAll('div, span, p'));
      const matches = all.filter((node) => {
        if ((node.textContent || '').trim() !== text) return false;
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      });
      const target = last ? matches[matches.length - 1] : matches[0];
      if (!target) return false;
      let clickable = target;
      while (clickable && !clickable.click) clickable = clickable.parentElement;
      target.scrollIntoView({ block: 'center' });
      target.click();
      return true;
    },
    text,
    last,
  );
  await sleep(450);
  return clicked;
}

/** Clicks the deepest visible element whose trimmed text starts with the prefix. */
async function clickTextPrefix(prefix, { last = true } = {}) {
  const clicked = await page.evaluate(
    (prefix, last) => {
      const all = Array.from(document.querySelectorAll('div, span, p'));
      const matches = all.filter((node) => {
        if (!(node.textContent || '').trim().startsWith(prefix)) return false;
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      });
      const target = last ? matches[matches.length - 1] : matches[0];
      if (!target) return false;
      target.scrollIntoView({ block: 'center' });
      target.click();
      return true;
    },
    prefix,
    last,
  );
  await sleep(450);
  return clicked;
}

async function screenshot(name) {
  await page.screenshot({ path: join(root, 'screenshots', `${name}.png`), fullPage: false });
}

await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60_000 });
const loaded = await waitForText('Net worth', 45_000);
check('app loaded', loaded);
await sleep(2500);

/* 1 — plus button → quick add sheet */
const fabClicked = await clickLabel('Add transaction');
check('plus button is clickable', fabClicked);
const quickAddOpen = await waitForText('Ask Wallnut');
check('plus sheet opens', quickAddOpen);
await screenshot('modal-quick-add');

const closeClicked = await clickLabel('Close');
check('sheet close button is clickable', closeClicked);
const quickAddClosed = await waitForTextGone('Ask Wallnut');
check('plus sheet closes', quickAddClosed);

/* 2 — plus sheet → expense composer */
await clickLabel('Add transaction');
await waitForText('Ask Wallnut');
const expenseClicked = await clickText('Expense');
check('plus sheet action is clickable', expenseClicked);
const composerOpen = await waitForText('Add expense', 10_000);
check('composer opens from the plus sheet', composerOpen);
await screenshot('modal-composer');
await page.goBack();
await waitForText('Net worth', 10_000);

/* 3 — global drawer overlay on a pushed screen (plain overlay, no Modal) */
await page.goto(`${base}/settings`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
const settingsOpen = await waitForText('Theme & colours', 45_000);
check('settings screen opens', settingsOpen);
await sleep(1200);
const menuClicked = await clickLabel('Open menu');
check('menu button on a pushed screen is clickable', menuClicked);
const menuOpen = await waitForText('Money owed', 6000);
check('global drawer opens over a pushed screen', menuOpen);
await screenshot('modal-global-drawer');
const menuClose = await clickLabel('Close menu');
check('global drawer closes', menuClose);
const menuGone = await waitForTextGone('Money owed', 6000);
check('global drawer overlay is gone', menuGone);

await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60_000 });
const homeAgain = await waitForText('Net worth', 45_000);
check('home reloads after the drawer check', homeAgain);
await sleep(2200);

/* 4 — filter sheet */
await clickLabel('Transactions');
await waitForText('Search transactions', 10_000);
const filterClicked = await clickLabel('Filters');
check('filter button is clickable', filterClicked);
const filterOpen = await waitForText('Choose categories');
check('filter sheet opens', filterOpen);
await screenshot('modal-filter');

/* 4 — filter → nested account picker */
const pickerClicked = await clickText('Choose accounts');
check('nested picker trigger is clickable', pickerClicked);
const pickerOpen = await waitForText('Filter by account');
check('nested picker opens above the filter sheet', pickerOpen);
await screenshot('modal-filter-picker');
const pickerClose = await clickLabel('Close');
check('nested picker close is clickable', pickerClose);
const pickerClosed = await waitForTextGone('Filter by account');
check('nested picker closes back to the filter sheet', pickerClosed);
const filterRestored = await bodyText();
check('filter sheet is still open after the picker closes', filterRestored.includes('Choose categories'));

/* 5 — filter → nested date picker */
const fromClicked = await clickText('From');
check('date chip is clickable', fromClicked);
const dateOpen = await waitForText('From date');
const calendarVisible = (await bodyText()).includes('Today');
check('nested date picker opens', dateOpen && calendarVisible);
await screenshot('modal-filter-date');
const todayClicked = await clickText('Today');
check('date picker quick chip is clickable', todayClicked);
const dateClosed = await waitForTextGone('From date');
check('date picker closes back to the filter sheet', dateClosed);
const filterBack = await waitForText('Choose categories');
check('filter sheet survives the date picker', filterBack);

/* 6 — apply closes the whole stack */
const applyClicked = await clickText('Apply');
check('apply is clickable', applyClicked);
const filterClosed = await waitForTextGone('Choose categories');
check('filter sheet closes after apply', filterClosed);
await sleep(900);

await screenshot('modal-filter-applied');

/* 7 — view options → filters (two sheets in the same tick) */
const viewOptionsClicked = await clickLabel('View options');
check('view options button is clickable', viewOptionsClicked);
const viewOptionsOpen = await waitForText('Group by');
check('view options sheet opens', viewOptionsOpen);
await sleep(700);
let switchClicked = await clickTextPrefix('Filters');
if (!switchClicked) switchClicked = await clickTextPrefix('Filters');
check('filters shortcut inside view options is clickable', switchClicked);
const filtersFromViewOptions = await waitForText('Choose categories');
check('filter sheet opens from view options', filtersFromViewOptions);
const appliedFromViewOptions = await clickText('Apply');
check('filter sheet from view options can be applied', appliedFromViewOptions);
const closedAgain = await waitForTextGone('Choose categories');
check('filter sheet from view options closes', closedAgain);

if (errors.length > 0) {
  console.log('\nCONSOLE ERRORS:');
  for (const line of errors.slice(0, 12)) console.log(`  ${line.slice(0, 220)}`);
}

await browser.close();

const failures = results.filter((entry) => !entry.pass);
console.log(`\n${results.length - failures.length}/${results.length} checks passed`);
if (failures.length > 0) process.exit(1);
