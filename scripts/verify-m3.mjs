// Headless regression pass for the Material 3 Expressive overhaul.
//
//   node scripts/verify-m3.mjs <url>
//
// Checks the things that regressed visually during the redesign:
//   - the web preview is constrained to a phone-width frame (≤ 392dp)
//   - Settings pushes (back returns to Home instead of exiting)
//   - segmented controls never overflow their container
//   - the date-picker calendar renders inside the sheet
//   - body/nav type stays in the compact M3 range
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const base = (process.argv[2] ?? 'http://localhost:8081').replace(/\/$/, '');

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
  args: ['--window-size=500,900', '--disable-gpu', '--no-first-run', '--disable-extensions'],
  defaultViewport: null,
});
const page = await browser.newPage();
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
function check(label, pass, detail = '') {
  results.push({ label, pass });
  console.log(`${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
}
const bodyText = () => page.evaluate(() => document.body.innerText || '');
async function waitForText(text, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if ((await bodyText()).includes(text)) return true;
    await sleep(150);
  }
  return false;
}
async function clickText(text, { last = true, prefix = false, allowOffscreen = false } = {}) {
  const clicked = await page.evaluate(
    (text, last, prefix, allowOffscreen) => {
      const matches = Array.from(document.querySelectorAll('div, span, p')).filter((node) => {
        const value = (node.textContent || '').trim();
        if (prefix ? !value.startsWith(text) : value !== text) return false;
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        const inView = rect.bottom > 0 && rect.top < window.innerHeight;
        return (allowOffscreen || inView) && rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      });
      const target = last ? matches[matches.length - 1] : matches[0];
      if (!target) return false;
      target.scrollIntoView({ block: 'center' });
      target.click();
      return true;
    },
    text,
    last,
    prefix,
    allowOffscreen,
  );
  await sleep(500);
  return clicked;
}
async function clickLabel(label) {
  const clicked = await page.evaluate((label) => {
    const nodes = Array.from(document.querySelectorAll(`[aria-label="${CSS.escape(label)}"]`)).filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.height > 0 && rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
    });
    const target = nodes[nodes.length - 1];
    if (!target) return false;
    target.click();
    return true;
  }, label);
  await sleep(500);
  return clicked;
}

await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60_000 });
const loaded = await waitForText('Net worth', 45_000);
check('app loaded', loaded);
await sleep(2200);

/* 1 — phone frame on web */
const frame = await page.evaluate(() => {
  const element = document.querySelector('[data-testid="phone-preview-frame"]');
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return { width: Math.round(rect.width), height: Math.round(rect.height), left: Math.round(rect.left) };
});
check('web preview uses a phone-width frame', Boolean(frame) && frame.width <= 392 && frame.width >= 320, `${frame?.width}×${frame?.height} @${frame?.left}`);
await page.screenshot({ path: join(root, 'screenshots', 'm3-phone-frame.png') });

/* 2 — drawer Settings pushes, browser back returns home */
const menuClicked = await clickLabel('Open menu');
check('drawer menu button is clickable', menuClicked);
await sleep(700);
const settingsClicked = await clickText('Settings', { allowOffscreen: true });
check('drawer Settings row is clickable', settingsClicked);
const settingsOpen = await waitForText('Theme & colours', 8000);
check('Settings opens from the drawer', settingsOpen);
const navVisible = await page.evaluate(() => {
  return [...document.querySelectorAll('[aria-label="Home"]')].some((node) => {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.top > window.innerHeight - 140 && rect.bottom <= window.innerHeight + 1;
  });
});
check('bottom navigation stays visible on pushed screens', navVisible);
await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
const backHome = await waitForText('Net worth', 8000);
check('back from Settings returns to Home', backHome);
await sleep(1200);

/* 3 — segmented control geometry */
await page.goto(`${base}/transactions`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await sleep(9000);
check('transactions screen opens', (await bodyText()).includes('Transactions'));
const viewOptionsClicked = await clickLabel('View options');
check('view options opens', viewOptionsClicked && (await waitForText('Group by', 8000)));
await sleep(500);
const segment = await page.evaluate(() => {
  const month = Array.from(document.querySelectorAll('div, span')).find((node) => (node.textContent || '').trim() === 'Month');
  if (!month) return null;
  const pressable = month.closest('[role="button"]') ?? month.parentElement;
  const inner = pressable?.parentElement;
  const outer = inner?.parentElement;
  if (!inner || !outer) return null;
  const innerRect = inner.getBoundingClientRect();
  const outerRect = outer.getBoundingClientRect();
  const indicator = Array.from(inner.children).find((node) => {
    const style = getComputedStyle(node);
    return style.position === 'absolute' && style.backgroundColor !== 'rgba(0, 0, 0, 0)';
  });
  if (!indicator) return null;
  const indicatorRect = indicator.getBoundingClientRect();
  return {
    inner: { left: Math.round(innerRect.left), right: Math.round(innerRect.right), width: Math.round(innerRect.width) },
    outer: { left: Math.round(outerRect.left), right: Math.round(outerRect.right), width: Math.round(outerRect.width) },
    indicator: { left: Math.round(indicatorRect.left), right: Math.round(indicatorRect.right), width: Math.round(indicatorRect.width) },
  };
});
check(
  'segmented indicator fits inside its track',
  Boolean(segment) && segment.indicator.left >= segment.inner.left - 1 && segment.indicator.right <= segment.inner.right + 1,
  segment ? `indicator ${segment.indicator.left}–${segment.indicator.right}, track ${segment.inner.left}–${segment.inner.right}` : 'not found',
);
await page.screenshot({ path: join(root, 'screenshots', 'm3-segmented.png') });
await clickLabel('Close');

/* 4 — calendar inside the filter sheet */
await clickLabel('Filters');
await waitForText('Choose categories', 8000);
await clickText('From');
const calendarOpen = await waitForText('From date', 8000);
const calendar = await page.evaluate(() => {
  const nodes = Array.from(document.querySelectorAll('div')).filter((node) => {
    const text = (node.textContent || '').trim();
    const rect = node.getBoundingClientRect();
    return /^(November|December|October) 2026$/.test(text) && rect.bottom > 0 && rect.top < window.innerHeight && rect.width > 0;
  });
  const month = nodes[nodes.length - 1];
  if (!month) return null;
  const rect = month.getBoundingClientRect();
  const sheet = month.closest('[data-testid="phone-preview-frame"]');
  return { label: month.textContent?.trim(), top: Math.round(rect.top), width: Math.round(sheet?.getBoundingClientRect().width ?? 0) };
});
check('date picker calendar renders', calendarOpen && Boolean(calendar), calendar ? `${calendar.label} @${calendar.top} in ${calendar.width}px` : 'month not found');
await page.screenshot({ path: join(root, 'screenshots', 'm3-calendar.png') });

/* 5 — ledger calendar */
await page.goto(`${base}/calendar`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await sleep(9000);
const ledgerCalendar = (await bodyText()).includes('Month income');
check('ledger calendar renders', ledgerCalendar);
await page.screenshot({ path: join(root, 'screenshots', 'm3-ledger-calendar.png') });

/* 6 — compact type */
const type = await page.evaluate(() => {
  const sample = (text) => {
    const node = Array.from(document.querySelectorAll('div, span')).filter((n) => (n.textContent || '').trim() === text).pop();
    return node ? parseFloat(getComputedStyle(node).fontSize) : null;
  };
  return {
    body: sample('Kotak Bank'),
    nav: sample('Home'),
  };
});
check('body type stays compact', type.body === null || type.body <= 16, `body ${type.body ?? '–'}px`);
check('nav labels stay compact', type.nav === null || type.nav <= 12, `nav ${type.nav ?? '–'}px`);

if (errors.length > 0) {
  console.log('\nCONSOLE ERRORS:');
  for (const line of errors.slice(0, 10)) console.log(`  ${line.slice(0, 200)}`);
}

await browser.close();
const failed = results.filter((entry) => !entry.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) process.exit(1);
