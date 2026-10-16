// Captures a screenshot of every major screen into ./screenshots.
//
//   node scripts/capture-screens.mjs [baseUrl] [width] [height]
//
// Uses the installed Chrome via puppeteer-core, waits for real content on each
// route (the SPA fallback serves index.html for every path), and reports the
// console errors it saw so a broken screen is never silently saved.
import { mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const [baseUrl = 'http://localhost:8081', width = '390', height = '844'] = process.argv.slice(2);

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

const SCREENS = [
  { name: '01-home', path: '/', waitFor: 'NET WORTH' },
  { name: '02-transactions', path: '/transactions', waitFor: 'Transactions' },
  { name: '03-transaction-new', path: '/transaction/new', waitFor: 'New transaction' },
  { name: '04-analytics', path: '/analytics', waitFor: 'Analytics' },
  { name: '05-accounts', path: '/accounts', waitFor: 'Accounts' },
  { name: '06-budgets', path: '/budgets', waitFor: 'Budgets' },
  { name: '07-goals', path: '/goals', waitFor: 'Goals' },
  { name: '08-debts', path: '/debts', waitFor: 'Money owed' },
  { name: '09-recurring', path: '/recurring', waitFor: 'Recurring' },
  { name: '10-calendar', path: '/calendar', waitFor: 'Calendar' },
  { name: '11-reports', path: '/reports', waitFor: 'Reports' },
  { name: '12-cashflow', path: '/reports/cashflow', waitFor: 'Cash flow' },
  { name: '13-health', path: '/reports/health', waitFor: 'Financial health' },
  { name: '14-review', path: '/review', waitFor: 'Review' },
  { name: '15-settings', path: '/settings', waitFor: 'Settings' },
  { name: '16-appearance', path: '/settings/appearance', waitFor: 'Appearance' },
  { name: '17-dashboard-editor', path: '/settings/dashboard', waitFor: 'Dashboard' },
  { name: '18-rules', path: '/rules', waitFor: 'Transaction rules' },
  { name: '19-templates', path: '/templates', waitFor: 'Quick templates' },
  { name: '20-import-export', path: '/data', waitFor: 'Import' },
];

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: [`--window-size=${width},${height}`, '--disable-gpu', '--no-first-run'],
  // Chrome 154+ rejects setDeviceMetricsOverride from older CDP clients.
  defaultViewport: null,
});

const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});

// Warm up: first load seeds the demo database, so every route after that is fast.
await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
for (let attempt = 0; attempt < 60; attempt++) {
  const body = await page.evaluate(() => document.body.innerText || '');
  if (body.includes('NET WORTH') || body.includes("couldn't start")) break;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

let captured = 0;
for (const screen of SCREENS) {
  try {
    await page.goto(`${baseUrl}${screen.path}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const started = Date.now();
    let ready = false;
    while (Date.now() - started < 20_000) {
      const body = await page.evaluate(() => document.body.innerText || '');
      if (body.includes(screen.waitFor) && body.length > 40) {
        ready = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    // Wait for figures (not just headers) so charts and gauges are populated,
    // then let their reveal animations finish.
    for (let attempt = 0; attempt < 16; attempt++) {
      const body = await page.evaluate(() => document.body.innerText || '');
      if (body.includes('₹') || /No spending|No transactions|Nothing to review|No budgets|No goals|No rules|No templates|No tags|No accounts|Available on the Android/i.test(body)) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await new Promise((resolve) => setTimeout(resolve, 1400));
    await page.screenshot({ path: join(root, 'screenshots', `${screen.name}.png`) });
    captured++;
    console.log(`${ready ? '✓' : '·'} ${screen.name}${ready ? '' : ' (content marker not found)'}`);
  } catch (error) {
    console.log(`✗ ${screen.name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

await browser.close();
console.log(`\n${captured}/${SCREENS.length} screenshots written to screenshots/`);
if (errors.length > 0) {
  console.log('\nCONSOLE ERRORS (deduplicated):');
  for (const line of Array.from(new Set(errors)).slice(0, 10)) console.log(`  ${line.slice(0, 200)}`);
}
