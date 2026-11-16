// Headless regression for the notification panel.
//   node scripts/verify-notifications.mjs
// Home → bell → panel → close → bell again (no stale open state).
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const base = process.argv[2] ?? 'http://localhost:8081';
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => existsSync(candidate));
if (!CHROME) {
  console.error('No Chrome/Edge found.');
  process.exit(1);
}

mkdirSync(join(root, 'screenshots'), { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--window-size=390,844', '--disable-gpu', '--no-first-run', '--disable-extensions'],
  defaultViewport: null,
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});

let passed = 0;
let failed = 0;
function check(label, value, detail = '') {
  if (value) {
    passed++;
    console.log(`✓ ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed++;
    console.log(`✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function bodyText() {
  return page.evaluate(() => document.body.innerText || '');
}
async function waitForText(text, timeout = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if ((await bodyText()).includes(text)) return true;
    await sleep(300);
  }
  return false;
}
async function clickLabel(label) {
  return page.evaluate((wanted) => {
    const nodes = [...document.querySelectorAll('[aria-label]')].filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    const exact = nodes.find((node) => node.getAttribute('aria-label') === wanted);
    const node = exact ?? nodes.find((candidate) => (candidate.getAttribute('aria-label') || '').includes(wanted));
    if (!node) return false;
    node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
    node.click();
    return true;
  }, label);
}

await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60_000 });
check('home loaded', await waitForText('Net worth', 45_000));
await sleep(2500);

const bell = await clickLabel('notification');
check('notification bell is clickable', bell);
const panel = await waitForText('Today’s check-in', 8000);
check('notification panel opens', panel);
const text = await bodyText();
check('panel shows priority summary', text.includes('Urgent') && text.includes('Action'));
check('panel shows inbox actions', text.includes('Financial Inbox'));
await page.screenshot({ path: join(root, 'screenshots', 'notifications-panel.png') });

const closed = await clickLabel('Close');
check('panel close control is clickable', closed);
await sleep(700);
const gone = !(await bodyText()).includes('Today’s check-in');
check('panel closes', gone);

const reopened = await clickLabel('notification');
check('bell works again after closing', reopened);
check('panel reopens cleanly', await waitForText('Today’s check-in', 6000));

check('no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | '));
await browser.close();
console.log(`\n${passed}/${passed + failed} checks passed`);
process.exit(failed > 0 ? 1 : 0);
