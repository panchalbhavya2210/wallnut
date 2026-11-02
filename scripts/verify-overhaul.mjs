// End-to-end browser verification for the Wallnut 2.0 overhaul.
// Covers: home, bottom navigation, drawer, insights tabs, merchant drill-down,
// transaction calculator, and an actual CSV download whose bytes are checked.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const base = process.env.WALLNUT_URL ?? 'http://localhost:8081';
const outDir = join(root, 'screenshots');
const downloadDir = join(root, '.expo', 'downloads');
mkdirSync(outDir, { recursive: true });
mkdirSync(downloadDir, { recursive: true });
rmSync(downloadDir, { recursive: true, force: true });
mkdirSync(downloadDir, { recursive: true });

const executablePath = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => existsSync(candidate));
if (!executablePath) throw new Error('No Chrome/Edge found.');

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--window-size=500,1100', '--disable-gpu', '--no-first-run', '--disable-extensions'],
  defaultViewport: null,
});
const page = await browser.newPage();
const errors = [];
const logs = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
  else logs.push(message.text());
});
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const text = () => page.evaluate(() => document.body.innerText || '');
const waitForText = async (needle, attempts = 60) => {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if ((await text()).includes(needle)) return true;
    await sleep(500);
  }
  return false;
};
const clickLabel = async (label, index = 0) => {
  const clicked = await page.evaluate(
    (value, idx) => {
      const targets = Array.from(document.querySelectorAll(`[aria-label="${value}"]`))
        .map((node) => {
          const rect = node.getBoundingClientRect();
          const width = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
          const height = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
          return { node, area: width * height };
        })
        .filter((entry) => entry.area > 0)
        .sort((a, b) => b.area - a.area);
      const target = targets[idx]?.node;
      if (!target) return false;
      target.click();
      return true;
    },
    label,
    index,
  );
  await sleep(450);
  return clicked;
};
const clickText = async (needle, { last = false } = {}) => {
  const clicked = await page.evaluate(
    (value, useLast) => {
      const candidates = Array.from(document.querySelectorAll('[role="button"], button, [tabindex="0"]'))
        .map((node) => {
          const rect = node.getBoundingClientRect();
          const width = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
          const height = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
          return { node, area: width * height };
        })
        .filter((entry) => entry.area > 0)
        .sort((a, b) => b.area - a.area)
        .map((entry) => entry.node);
      const exact = candidates.filter((node) => (node.textContent || '').trim() === value);
      const loose = candidates.filter((node) => (node.textContent || '').includes(value));
      const pool = exact.length > 0 ? exact : loose;
      const target = useLast ? pool[pool.length - 1] : pool[0];
      if (!target) return false;
      target.click();
      return true;
    },
    needle,
    last,
  );
  await sleep(600);
  return clicked;
};
const screenshot = (name) => page.screenshot({ path: join(outDir, `${name}.png`), fullPage: false });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const waitForSelector = async (selector, attempts = 40) => {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const found = await page.evaluate((value) => Boolean(document.querySelector(value)), selector);
    if (found) return true;
    await sleep(250);
  }
  return false;
};

// ---------------------------------------------------------------- boot + home
await page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
check('home boots', await waitForText('Net Worth'), 'Net Worth hero');
await sleep(2500);
let body = await text();
check('home has quick actions', /Add expense[\s\S]{0,120}Add income[\s\S]{0,120}Transfer/.test(body));
check('home has five primary destinations', /Home[\s\S]{0,80}Transactions[\s\S]{0,80}Budgets[\s\S]{0,80}Insights[\s\S]{0,80}More/.test(body));
check('home hero has no chart (reference layout)', !/NET WORTH[\s\S]{0,200}chart/i.test(body));
await screenshot('overhaul-home');

await clickLabel('More');
await sleep(700);
const moreDrawerVisible = await page.evaluate(() => {
  const nodes = Array.from(document.querySelectorAll('*')).filter((node) => (node.textContent || '').trim() === 'Signed for You');
  return nodes.some((node) => {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.left >= 0 && rect.top >= 0 && rect.left < innerWidth;
  });
});
check('More tab opens the native drawer', moreDrawerVisible);
await screenshot('overhaul-drawer-native');
await page.mouse.click(470, 400);
await sleep(700);

// ------------------------------------------------------------------ navigation
await clickLabel('Transactions');
check('bottom nav opens Transactions', await waitForText('Week'), 'statement groups');
body = await text();
check('transaction totals render', /Total/.test(body) && /₹/.test(body));
await screenshot('overhaul-transactions');

await clickLabel('Insights');
check('bottom nav opens Insights', await waitForText('Total spending'), 'overview tiles');
await clickLabel('Categories');
await sleep(1200);
body = await text();
check('insights Categories tab renders a reconciled total', /Total spending/.test(body) && /reconciled with the transactions/.test(body));
check('categories show share and amounts', /% of spending/.test(body) && /₹/.test(body));
await screenshot('overhaul-insights-categories');


await sleep(1200);
body = await text();
check('insights Merchants tab explains the concept', /A merchant is where you spent/.test(body));
check('merchant ranking renders', /Spending by merchant|Merchant spending/.test(body) && /% of spending/.test(body));
await screenshot('overhaul-insights-merchants');

// merchant drill-down: click the ranked row with an amount in its aria label
const merchantLabel = await page.evaluate(() => {
  const nodes = Array.from(document.querySelectorAll('[aria-label]')).filter((node) => {
    const label = node.getAttribute('aria-label') || '';
    return /transactions$/.test(label) && /₹/.test(label);
  });
  return nodes[0]?.getAttribute('aria-label') ?? '';
});
if (merchantLabel) {
  await clickLabel(merchantLabel);
  check('merchant detail opens from the ranking', await waitForText('of all spending this period'));
  await screenshot('overhaul-merchant-detail');
} else {
  check('merchant detail opens from the ranking', false, 'no merchant row found');
}

// ---------------------------------------------------------------------- drawer
await clickLabel('Open menu');
const drawerOpen = await waitForText('Signed for You', 30);
check('header menu opens the navigation drawer from a pushed screen', drawerOpen);
await screenshot('overhaul-drawer');
// Search the drawer, then close it with Escape / backdrop.
const searched = await page.evaluate(() => {
  const input = Array.from(document.querySelectorAll('input')).find(
    (node) => (node.placeholder || '').toLowerCase().includes('search settings'),
  );
  if (!input) return false;
  input.focus();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, 'settings');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
});
if (searched) {
  await sleep(800);
  body = await text();
  check('drawer search filters destinations', /Settings/.test(body));
}
await clickLabel('Close menu');
await sleep(700);
await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
await waitForSelector('[aria-label="Add transaction"]', 80);
await sleep(1000);

// ------------------------------------------------------------------ calculator
check('floating add is present on Home', await clickLabel('Add transaction'));
check('floating add opens quick actions', await waitForText('Ask Wallnut'));
await clickLabel('Expense');
check('floating add opens the composer', await waitForText('New transaction'));
await clickLabel('Open amount calculator');
check('calculator sheet opens', await waitForText('Amount calculator'));
for (const key of ['4', '5', '0', '+', '1', '2', '0', '×', '2', '=']) {
  await clickLabel(key);
}
await sleep(500);
body = await text();
check('calculator evaluates 450 + 120 × 2 = 690', /₹690/.test(body));
await screenshot('overhaul-calculator');
const useAmount = await clickLabel('Use ₹690');
check('calculator applies the result', useAmount);
await sleep(700);
body = await text();
check('composer amount updated to 690', /690/.test(body));
await screenshot('overhaul-composer');

// ---------------------------------------------------------------------- export
const cdp = await page.createCDPSession();
await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });
await page.goto(`${base}/data`, { waitUntil: 'domcontentloaded' });
check('export screen opens', await waitForText('Export transactions'));
await sleep(1800);
body = await text();
check('export shows a real record count', /transaction[s]?/.test(body) && /\d/.test(body));
// The button label is dynamic; click by aria-label prefix through the DOM.
const clickedExport = await page.evaluate(() => {
  const node = Array.from(document.querySelectorAll('[aria-label]')).find((element) =>
    /^Export \d+ transactions$/.test(element.getAttribute('aria-label') || ''),
  );
  node?.click();
  return Boolean(node);
});
check('export action starts', clickedExport);
check('export reports a completed file', await waitForText('Export ready', 40));
await sleep(1200);
const files = readdirSync(downloadDir).filter((file) => file.endsWith('.csv'));
if (files.length > 0) {
  const csv = readFileSync(join(downloadDir, files[0]), 'utf8');
  check('CSV download exists', true, files[0]);
  check('CSV has a BOM and stable header', csv.startsWith('\uFEFFDate,Type,Amount,Currency,Account'));
  check('CSV contains signed amounts', /,-?\d+\.\d{2},INR,/.test(csv));
  writeFileSync(join(downloadDir, 'checked.csv.txt'), csv.slice(0, 500), 'utf8');
} else {
  check('CSV download exists', false, 'browser download not captured');
}

// JSON export round-trip.
await clickLabel('JSON');
await sleep(500);
const clickedJson = await page.evaluate(() => {
  const node = Array.from(document.querySelectorAll('[aria-label]')).find((element) =>
    /^Export \d+ transactions$/.test(element.getAttribute('aria-label') || ''),
  );
  node?.click();
  return Boolean(node);
});
check('JSON export action starts', clickedJson);
let jsonFile = null;
for (let attempt = 0; attempt < 40 && !jsonFile; attempt++) {
  const candidate = readdirSync(downloadDir).find((file) => file.endsWith('.json'));
  if (candidate) jsonFile = candidate;
  else await sleep(250);
}
if (jsonFile) {
  const parsed = JSON.parse(readFileSync(join(downloadDir, jsonFile), 'utf8'));
  check('JSON download parses', parsed.app === 'wallnut' && parsed.kind === 'transactions' && parsed.version === 1);
  check('JSON count matches its transaction array', parsed.count === parsed.transactions.length && parsed.count > 0);
  check('JSON amounts are integer minor units', Number.isInteger(parsed.transactions[0].amount));
} else {
  check('JSON download parses', false, 'browser download not captured');
}
await screenshot('overhaul-export');

check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));

console.log('\nRESULT', results.every((entry) => entry.ok) ? 'PASS' : 'FAIL');
console.log(`console errors: ${errors.length}`);
if (errors.length > 0) console.log(errors.slice(0, 10).join('\n'));
await browser.close();
process.exit(results.every((entry) => entry.ok) ? 0 : 1);
