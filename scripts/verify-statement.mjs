// End-to-end verification of statement import staging (Pass 21):
// CSV → map → preview → stage → review (edit + merchant memory) → inbox → commit
// → the ledger shows the confirmed rows with their "Imported" badge.
//
//   node scripts/verify-statement.mjs [baseUrl]
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const base = process.argv[2] ?? 'http://localhost:8081';
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
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

mkdirSync(join(ROOT, 'screenshots'), { recursive: true });
mkdirSync(join(ROOT, '.expo', 'verify'), { recursive: true });
const csvPath = join(ROOT, '.expo', 'verify', 'statement-fixture.csv');
writeFileSync(
  csvPath,
  [
    'Date,Merchant,Description,Amount,Category',
    '2026-10-01,Starbucks Coffee,Card payment,-420,Food & Dining',
    '2026-10-01,Starbucks Coffee,Card payment,-420,Food & Dining',
    '2026-10-02,AMZN Mktp IN,Order 4412,-1499,Shopping',
    '2026-10-03,Salary Credit,Salary for October,60450,Salary',
    '2026-10-04,Ola Cabs,Ride to airport,-230,Transport',
    'not-a-date,Broken,Broken row,,Misc',
  ].join('\n'),
  'utf8',
);

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--window-size=500,900', '--disable-gpu', '--no-first-run'],
  defaultViewport: null,
});
const page = await browser.newPage();
const consoleErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

const text = () => page.evaluate(() => document.body.innerText || '');
const waitForText = async (needle, attempts = 80) => {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if ((await text()).includes(needle)) return true;
    await sleep(500);
  }
  return false;
};
const clickText = async (needle, { last = false } = {}) => {
  const clicked = await page.evaluate(
    (value, useLast) => {
      const candidates = Array.from(document.querySelectorAll('[role="button"], [role="checkbox"], button, [tabindex="0"]')).filter(
        (node) => (node.getBoundingClientRect().width ?? 0) > 0,
      );
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
  await sleep(400);
  return clicked;
};
const clickLabel = async (label, index = 0) => {
  const clicked = await page.evaluate(
    (value, idx) => {
      const targets = Array.from(document.querySelectorAll(`[aria-label="${value}"]`)).filter(
        (node) => (node.getBoundingClientRect().width ?? 0) > 0,
      );
      const target = targets[idx];
      if (!target) return false;
      target.click();
      return true;
    },
    label,
    index,
  );
  await sleep(400);
  return clicked;
};
const screenshot = async (name) => {
  await page.screenshot({ path: join(ROOT, 'screenshots', `${name}.png`), fullPage: false });
};

// ---------------------------------------------------------------- home first
await page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await waitForText('NET WORTH');
await sleep(2500);
let body = await text();
check('home shows quick actions with Import', /Add expense[\s\S]{0,200}Add income[\s\S]{0,200}Transfer[\s\S]{0,200}Import/.test(body));

// --------------------------------------------------------------- import flow
await page.goto(`${base}/data`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
check('data screen opens', await waitForText('Import & export'));
await sleep(1500);

const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 30_000 }), clickText('Import CSV')]);
await chooser.accept([csvPath]);
check('CSV mapped screen', await waitForText('Map columns'));
await sleep(500);
await clickText('Preview import');
check('preview screen', await waitForText('Preview import', 60));
await sleep(1000);
body = await text();
check('preview counts (4 new, 1 duplicate, 1 invalid)', /4\s*\n?New/.test(body) && /1\s*\n?Duplicates/.test(body) && /1\s*\n?Invalid/.test(body));

await clickText('Review 4 transactions');
await sleep(2500);
check('review screen', await waitForText('Review transactions'));
await sleep(1200);
body = await text();
check('review says nothing is in the ledger yet', body.includes('nothing is in your ledger yet'));
check('review shows the duplicate chip', body.includes('Possible duplicate'));
check('review shows statement rows', body.includes('Starbucks') && body.includes('Salary Credit'));
await screenshot('statement-review');

const reviewUrl = page.url();

// ------------------------------------------------------------ edit + memory
const openedEdit = await clickLabel('Edit this row', 2);
await sleep(800);
check('edit sheet opens', openedEdit && (await waitForText('Edit this row')));
await screenshot('statement-edit');

// Toggle "Always suggest this category" (the Amazon row has merchant + category).
const toggled = await clickText('Always suggest this category');
await sleep(400);
if (toggled) {
  await clickText('Save changes');
  check('merchant memory toast', await waitForText('Wallnut will suggest this', 30));
} else {
  await clickText('Save changes');
  console.log('·  (no row exposed the remember toggle)');
}
await sleep(800);

// ------------------------------------------------------------------- inbox
await page.goto(`${base}/inbox`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
check('inbox lists the staged import', await waitForText('Review', 60));
body = await text();
check('inbox item mentions waiting rows', /row(s)? waiting · nothing is in your ledger yet/.test(body));
await screenshot('inbox-statement');

// ------------------------------------------------------------------ commit
await page.goto(reviewUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await waitForText('Review transactions');
await sleep(1500);
const addLabel = (await text()).match(/Add (\d+) transactions/);
check('commit button counts selectable rows', Boolean(addLabel) && (addLabel?.[1] === '4' || addLabel?.[1] === '5'));
await clickText(addLabel ? `Add ${addLabel[1]} transactions` : 'Add');
// Leaving the review screen is the success signal (it lands on the dashboard
// in-app, or the previous page on a deep-linked web load).
let leftReview = false;
for (let attempt = 0; attempt < 60 && !leftReview; attempt++) {
  body = await text();
  if (!body.includes('nothing is in your ledger yet') || body.includes('NET WORTH')) leftReview = true;
  else await sleep(500);
}
console.log(`  landed on ${page.url()}`);
check('import completes (review screen dismissed)', leftReview);
await sleep(1500);

// ------------------------------------------------------------ ledger check
await page.goto(`${base}/transactions`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await waitForText('Transactions', 80);
await sleep(2500);
body = await text();
check('ledger shows the imported rows', body.includes('Starbucks Coffee') || body.includes('Amazon'));
check('imported rows carry the badge', body.includes('Imported'));
await screenshot('transactions-imported');

// ------------------------------------------------------- merchant memory rule
await page.goto(`${base}/rules`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await waitForText('Rules', 40);
await sleep(2000);
body = await text();
check('merchant memory saved a rule', body.includes('Remember Amazon'));
await screenshot('rules-merchant-memory');

if (consoleErrors.length > 0) {
  console.log('\nCONSOLE ERRORS:');
  for (const line of consoleErrors.slice(0, 10)) console.log(`  ${line.slice(0, 220)}`);
}

await browser.close();
console.log(failures.length === 0 ? '\nALL CHECKS PASSED' : `\n${failures.length} FAILED: ${failures.join(' | ')}`);
process.exit(failures.length === 0 ? 0 : 1);
