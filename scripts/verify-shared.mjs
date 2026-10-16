// End-to-end verification of shared expenses on the exported web build:
// create people → split a ₹4,000 dinner four ways → the ledger records only the
// user's ₹1,000 share while Money Owed shows the ₹3,000 receivable.
//
//   node scripts/verify-shared.mjs [baseUrl]
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
const readNetWorth = async () => {
  const body = await text();
  const match = body.match(/NET WORTH\s*₹([\d,]+(?:\.\d{1,2})?)/);
  return match ? Number(match[1].replace(/,/g, '')) : null;
};
const waitForText = async (needle, attempts = 80) => {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if ((await text()).includes(needle)) return true;
    await sleep(500);
  }
  return false;
};
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
  await sleep(300);
  return clicked;
};
const clickLabel = async (label) => {
  const clicked = await page.evaluate((value) => {
    const target = document.querySelector(`[aria-label="${value}"]`);
    if (!target) return false;
    target.click();
    return true;
  }, label);
  await sleep(300);
  return clicked;
};
const clickLabelLast = async (label) => {
  const clicked = await page.evaluate((value) => {
    const targets = document.querySelectorAll(`[aria-label="${value}"]`);
    const target = targets[targets.length - 1];
    if (!target) return false;
    target.click();
    return true;
  }, label);
  await sleep(300);
  return clicked;
};
const setInputValue = async (selector, value) => {
  return page.evaluate(
    (sel, val) => {
      const input = document.querySelector(sel);
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, val);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    },
    selector,
    value,
  );
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

try {
  // 0. Net worth before: the ₹4,000 payment must only cost the ₹1,000 own share.
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  check('home renders', await waitForText('NET WORTH'));
  await sleep(2500);
  const netWorthBefore = await readNetWorth();
  check('net worth readable before the expense', netWorthBefore !== null);

  // 1. The shared expense screen opens with an honest empty state.
  await page.goto(`${base}/shared`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  check('shared screen loads', await waitForText('Shared expenses'));
  await sleep(1200);
  check('empty state explains the concept', (await text()).includes('No shared expenses yet'));
  await clickText('Create a shared expense');
  check('shared composer opens', await waitForText('Add another expense'));

  // 2. ₹4,000 dinner, paid by You.
  await typeInto('input[placeholder="0"]', '4000');
  await typeInto('input[placeholder^="e.g. Train travel"]', 'Dinner');
  await sleep(300);

  // 3. Add three people (Rahul, Amit, Neha) — names only, no accounts.
  for (const name of ['Rahul', 'Amit', 'Neha']) {
    await clickText('New person');
    await sleep(700);
    const typed = await typeInto('input[placeholder="e.g. Rahul"]', name);
    check(`person sheet for ${name}`, typed);
    await clickText('Add person');
    await sleep(900);
  }
  const splitText = await text();
  check('all three people appear in the split', splitText.includes('Rahul') && splitText.includes('Amit') && splitText.includes('Neha'));
  check('preview shows ₹1,000 as your share', splitText.includes('1,000'));
  check('preview shows ₹3,000 owed to you', splitText.includes('3,000'));

  // 4. Save and land back on the overview.
  const saved = await clickText('Add shared expense');
  check('save button clicked', saved);
  const backOnOverview = await waitForText('YOU ARE OWED');
  check('overview shows the receivable', backOnOverview);
  await sleep(800);
  const overview = await text();
  check('overview totals ₹3,000 owed to you', overview.includes('3,000'));
  check('group-free expense appears in recent splits', overview.includes('Dinner'));
  await page.screenshot({ path: 'screenshots/shared.png' });

  // 4b. Net worth dropped by exactly the ₹1,000 own share — the ₹3,000 is a receivable.
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await waitForText('NET WORTH');
  await sleep(2500);
  const netWorthAfter = await readNetWorth();
  check(
    `net worth dropped by exactly ₹1,000 (was ${netWorthBefore}, now ${netWorthAfter})`,
    netWorthBefore !== null && netWorthAfter !== null && Math.round((netWorthBefore - netWorthAfter) * 100) === 1_000_00,
  );

  // 5. The ledger records ONLY the user's share as spending.
  await page.goto(`${base}/transactions`, { waitUntil: 'domcontentloaded' });
  await waitForText('Transactions');
  await sleep(2000);
  const ledger = await text();
  check('ledger shows the shared expense', ledger.includes('Dinner'));
  check('ledger records ₹1,000 (your share), not ₹4,000', ledger.includes('1,000') && !ledger.includes('4,000'));

  // 6. Money Owed includes the computed shared balance.
  await page.goto(`${base}/debts`, { waitUntil: 'domcontentloaded' });
  await waitForText('Money owed');
  await sleep(2000);
  const debts = await text();
  check('money owed lists the shared balances', debts.includes('Rahul') && debts.includes('Amit') && debts.includes('Neha'));
  check('money owed totals ₹3,000', debts.includes('3,000'));
  check('shared expenses entry point exists', debts.includes('Shared expenses'));

  // 7. Partial settlement from the person screen (Rahul owes ₹1,000 → pays ₹500).
  await clickText('Rahul');
  check('person screen opens', await waitForText('SHARED EXPENSES'));
  await sleep(800);
  await clickText('Settle up');
  await sleep(800);
  check('settle sheet opens', (await text()).includes('Rahul owes you'));
  await clickText('Half');
  await sleep(400);
  await clickText('Record settlement');
  await sleep(1500);
  const afterSettlement = await text();
  check('partial settlement recorded (₹500 outstanding)', afterSettlement.includes('500'));
  check('settlement listed as activity', afterSettlement.includes('Settlement received'));

  // 8. Deleting the settlement restores the balance.
  check('settlement delete button found', await clickLabel('Delete settlement'));
  await sleep(500);
  await clickText('Delete');
  await sleep(1500);
  const afterDelete = await text();
  check('balance restored to ₹1,000', afterDelete.includes('1,000'));
  check('settlement removed from activity', !afterDelete.includes('Settlement received'));

  // 9. Edit the expense — totals and balances stay correct.
  await page.goto(`${base}/shared`, { waitUntil: 'domcontentloaded' });
  await waitForText('RECENT SPLITS');
  await sleep(800);
  await clickText('Dinner');
  check('expense detail opens', await waitForText('PARTICIPANTS'));
  check('expense edit button found', await clickLabel('Edit shared expense'));
  await waitForText('Add another expense');
  check('title replaced for the edit', await setInputValue('input[placeholder^="e.g. Train travel"]', 'Dinner (updated)'));
  await sleep(400);
  await clickText('Save changes');
  await sleep(1800);
  const afterEdit = await text();
  check('expense shows the updated title', afterEdit.includes('Dinner (updated)'));

  // 10. Delete the expense — everything unwinds.
  check('expense edit button found again', await clickLabel('Edit shared expense'));
  await waitForText('Add another expense');
  check('expense delete button found', await clickLabel('Delete'));
  await sleep(500);
  await clickText('Delete');
  await sleep(1800);
  await page.goto(`${base}/shared`, { waitUntil: 'domcontentloaded' });
  await waitForText('Shared expenses');
  await sleep(1200);
  check('expense deleted → empty state returns', (await text()).includes('No shared expenses yet'));

  // 11. Someone else paid: a payable appears and NO cash row is written.
  await clickText('Create a shared expense');
  check('composer opens for the payer case', await waitForText('Add another expense'));
  await typeInto('input[placeholder="0"]', '3000');
  await typeInto('input[placeholder^="e.g. Train travel"]', 'Airport ride');
  // Add Rahul as a payer (split payment), then remove yourself so he covered it all.
  check('payer chip found', await clickLabel('Payer Rahul'));
  await sleep(700);
  check('default payer chip found', await clickLabel('Payer You'));
  await sleep(600);
  const payablePreview = await text();
  check('sole payer note shows', payablePreview.includes('Rahul covered the full bill'));
  check('preview shows you owe ₹1,500', payablePreview.includes('You owe') && payablePreview.includes('1,500'));
  await clickText('Add shared expense');
  await sleep(1800);
  const payableOverview = await text();
  check('overview shows the ₹1,500 payable', payableOverview.includes('1,500'));

  await page.goto(`${base}/transactions`, { waitUntil: 'domcontentloaded' });
  await waitForText('Transactions');
  await sleep(2000);
  const ledgerText = await text();
  if (ledgerText.includes('Airport ride')) {
    console.log('  debug — lines containing the shared title:', JSON.stringify(ledgerText.split('\n').filter((line) => line.includes('Airport ride'))));
  }
  check('no ledger row when someone else paid', !ledgerText.includes('Airport ride'));

  await page.goto(`${base}/debts`, { waitUntil: 'domcontentloaded' });
  await waitForText('Money owed');
  await sleep(2000);
  await clickText('Rahul');
  check('person screen shows the payable', await waitForText('SHARED EXPENSES'));
  await sleep(800);
  const rahulText = await text();
  check('person shows you owe Rahul ₹1,500', rahulText.includes('You owe') && rahulText.includes('1,500'));
} catch (error) {
  console.error(`Verification failed: ${error instanceof Error ? error.message : error}`);
  failures.push('unexpected error');
}

await browser.close();
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nShared-expense flow verified');
