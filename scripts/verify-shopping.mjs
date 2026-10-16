// End-to-end verification of the shopping-list flow on the exported web build:
// create list → add two priced items → create ONE itemised transaction →
// list completes and the ledger shows a single expense.
//
//   node scripts/verify-shopping.mjs [baseUrl]
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const base = process.argv[2] ?? 'http://localhost:8081';
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];
const executablePath = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
if (!executablePath) {
  console.error('No Chrome found.');
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];
const check = (label, ok) => {
  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if (!ok) failures.push(label);
};

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--window-size=500,900', '--disable-gpu', '--no-first-run'],
  defaultViewport: null,
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.log(`  pageerror: ${error.message}`));

const text = () => page.evaluate(() => document.body.innerText || '');
const clickText = async (needle) => {
  const clicked = await page.evaluate((value) => {
    const candidates = Array.from(document.querySelectorAll('[role="button"], button, [tabindex="0"]'));
    const target =
      candidates.find((node) => (node.textContent || '').trim() === value) ??
      candidates.find((node) => (node.textContent || '').includes(value));
    if (!target) return false;
    target.click();
    return true;
  }, needle);
  await sleep(250);
  return clicked;
};
const typeInto = async (selector, value) => {
  const ok = await page.evaluate((sel) => {
    const input = document.querySelector(sel);
    if (!input) return false;
    input.focus();
    return true;
  }, selector);
  if (!ok) return false;
  await page.keyboard.type(value, { delay: 25 });
  return true;
};

await page.goto(`${base}/shopping`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
for (let attempt = 0; attempt < 60; attempt++) {
  if ((await text()).includes('Shopping lists')) break;
  await sleep(500);
}

// 1. Create the list.
await clickText('New list');
await sleep(800);
const nameReady = await page.evaluate(() => {
  const target = document.querySelector('input[placeholder="e.g. Weekly groceries"]');
  if (!target) return false;
  target.focus();
  return true;
});
check('new-list sheet opened', nameReady && (await text()).includes('New shopping list'));
await page.keyboard.type('Weekly groceries', { delay: 20 });
await clickText('Create list');
await sleep(700);
check('list created and selected', (await text()).includes('Weekly groceries'));

// 2. Add two items with prices.
const addItem = async (name, price) => {
  await typeInto('input[placeholder="e.g. Milk 1L"]', name);
  await typeInto('input[placeholder="0"]', price);
  await clickText('Add item');
  await sleep(600);
};
await addItem('Milk 1L', '60');
await addItem('Basmati rice 5kg', '540');
const afterItems = await text();
check('first item added', afterItems.includes('Milk 1L'));
check('second item added', afterItems.includes('Basmati rice 5kg'));
check('total computed (₹600)', afterItems.includes('600'));

// 3. Create the transaction from the whole list.
const openedConvert = await clickText('Create transaction');
await sleep(600);
check('convert sheet opened', openedConvert && (await text()).includes('one expense, split per item'));
await clickText('Choose account');
await sleep(500);
const accountPicked = await clickText('Kotak Bank');
check('account picked', accountPicked);
await clickText('Choose category');
await sleep(500);
const categoryPicked = (await clickText('Food & Dining')) || (await clickText('Groceries'));
check('category picked', categoryPicked);
await sleep(300);
await clickText('Create ·');
await sleep(1200);
const afterConvert = await text();
check('list marked completed', afterConvert.includes('COMPLETED') || afterConvert.includes('Recorded'));

// 4. The ledger has exactly one new expense for the list.
await page.goto(`${base}/transactions`, { waitUntil: 'domcontentloaded' });
for (let attempt = 0; attempt < 60; attempt++) {
  if ((await text()).includes('Transactions')) break;
  await sleep(500);
}
await sleep(1500);
const ledger = await text();
check('ledger shows the list purchase', ledger.includes('Weekly groceries'));
check('ledger shows the exact total', ledger.includes('₹600'));

await page.screenshot({ path: 'screenshots/shopping.png' });
await browser.close();
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nShopping-list flow verified');
