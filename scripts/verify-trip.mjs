// End-to-end verification of the multi-payer trip flow on the exported web build.
//
// Scenario: four friends on a Goa trip.
//   • Villa ₹30,000 — you pay ₹20,000, Rahul pays ₹10,000, split 4 ways.
//   • Airport ride ₹3,000 — Rahul pays it all, split 4 ways.
// Expected member balances: you +₹11,750 · Rahul +₹4,750 ·
//                           Amit −₹8,250 · Neha −₹8,250
// The group screen must suggest the fewest transfers and let a settlement
// between two other members be recorded.
//
//   node scripts/verify-trip.mjs [baseUrl]
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
  await sleep(350);
  return clicked;
};
const clickTextLast = async (needle) => {
  const clicked = await page.evaluate((value) => {
    const candidates = Array.from(document.querySelectorAll('[role="button"], button, [tabindex="0"]')).filter(
      (node) => (node.textContent || '').trim() === value,
    );
    const target = candidates[candidates.length - 1];
    if (!target) return false;
    target.click();
    return true;
  }, needle);
  await sleep(350);
  return clicked;
};
const clickLabel = async (label) => {
  const clicked = await page.evaluate((value) => {
    const targets = document.querySelectorAll(`[aria-label="${value}"]`);
    const target = targets[targets.length - 1];
    if (!target) return false;
    target.click();
    return true;
  }, label);
  await sleep(350);
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
/** Replaces the value of the nth input matching a selector (React-aware). */
const setInputAt = async (selector, index, value) => {
  return page.evaluate(
    (sel, idx, val) => {
      const input = document.querySelectorAll(sel)[idx];
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, val);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    },
    selector,
    index,
    value,
  );
};

const addPerson = async (name) => {
  await clickText('New person');
  await sleep(700);
  await typeInto('input[placeholder="e.g. Rahul"]', name);
  await clickText('Add person');
  await sleep(900);
};

try {
  // Boot first: deep-linking before the first boot finishes races the redirect.
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  check('app boots', await waitForText('NET WORTH'));
  await sleep(1800);

  // 1. Create the group (the overview offers "Start a group instead" when empty).
  await page.goto(`${base}/shared`, { waitUntil: 'domcontentloaded' });
  await waitForText('Shared expenses');
  await sleep(1500);
  const openedGroupSheet = (await clickText('Start a group instead')) || (await clickText('New group'));
  check('group sheet opens', openedGroupSheet);
  await sleep(700);
  await typeInto('input[placeholder^="e.g. Goa Trip"]', 'Goa Trip');
  await clickText('Create group');
  check('group screen opens', await waitForText('TOTAL SPENT'));
  await sleep(800);

  // 2. Villa: ₹30,000, you pay ₹20,000 and Rahul pays ₹10,000, 4-way split.
  check('new-expense button found', await clickLabel('New expense in group'));
  await waitForText('Add another expense');
  await typeInto('input[placeholder="0"]', '30000');
  await typeInto('input[placeholder^="e.g. Train travel"]', 'Villa');
  await addPerson('Rahul');
  await addPerson('Amit');
  await addPerson('Neha');
  const splitText = await text();
  check('four people in the split', ['Rahul', 'Amit', 'Neha'].every((name) => splitText.includes(name)));
  check('your share shows ₹7,500', splitText.includes('7,500'));

  // Split payment: add Rahul as a payer, then set 20,000 / 10,000.
  check('payer chip found', await clickLabel('Payer Rahul'));
  await sleep(700);
  const twoPayers = await text();
  check('two payers shown', twoPayers.includes('2 payers'));
  check('payer amount field 1 set', await setInputAt('input[placeholder="0"]', 1, '20000'));
  check('payer amount field 2 set', await setInputAt('input[placeholder="0"]', 2, '10000'));
  await sleep(600);
  const villaPreview = await text();
  check('payments add up note', villaPreview.includes('Payments add up to'));
  check('preview shows you paid ₹20,000', villaPreview.includes('20,000'));
  check('preview shows you are owed ₹12,500', villaPreview.includes('12,500'));
  await page.screenshot({ path: 'screenshots/shared-composer.png' });
  await page.mouse.move(250, 520);
  await page.mouse.wheel({ deltaY: 480 });
  await sleep(600);
  await page.screenshot({ path: 'screenshots/shared-composer-split.png' });
  await clickText('Add shared expense');
  await sleep(2000);
  const afterVilla = await text();
  check('group shows ₹30,000 spent', afterVilla.includes('30,000'));
  check('group shows you paid ₹20,000', afterVilla.includes('20,000'));
  check('group shows you should receive ₹12,500', afterVilla.includes('12,500'));
  await page.screenshot({ path: 'screenshots/group-trip.png' });

  // 3. Airport ride: ₹3,000, Rahul pays it all, 4-way split.
  //    Members are prefilled from the group, so no chip taps are needed.
  check('second new-expense button found', await clickLabel('New expense in group'));
  await waitForText('Add another expense');
  await typeInto('input[placeholder="0"]', '3000');
  await typeInto('input[placeholder^="e.g. Train travel"]', 'Airport ride');
  check('group members prefilled into the split', await waitForText('750'));
  check('payer chip again', await clickLabel('Payer Rahul'));
  await sleep(600);
  check('remove own payer chip', await clickLabel('Payer You'));
  await sleep(600);
  const ridePreview = await text();
  check('Rahul covers the ride', ridePreview.includes('Rahul covered the full bill'));
  check('preview shows you owe ₹750', ridePreview.includes('You owe') && ridePreview.includes('750'));
  await clickText('Add shared expense');
  await sleep(2000);

  // 4. Group summary after both expenses.
  const tripText = await text();
  check('total spent ₹33,000', tripText.includes('33,000'));
  check('your share ₹8,250', tripText.includes('8,250'));
  check('you should receive ₹11,750', tripText.includes('11,750'));

  // 5. Balances tab: member balances and the fewest-transfer suggestions.
  await clickText('Balances');
  await sleep(1200);
  const balancesText = await text();
  check('settlements section renders', balancesText.includes('SETTLEMENTS TO MAKE'));
  check('member balances render', balancesText.includes('MEMBER BALANCES'));
  check('Amit owes you ₹8,250', balancesText.includes('Amit → You') && balancesText.includes('8,250'));
  check('Neha owes Rahul ₹4,750', balancesText.includes('Neha → Rahul') && balancesText.includes('4,750'));
  await page.screenshot({ path: 'screenshots/group-balances.png' });

  // 6. Record the Neha → Rahul settlement (between two other members).
  check('record button found', await clickLabel('Record Neha to Rahul'));
  await sleep(800);
  check('confirm sheet shows the transfer', (await text()).includes('Neha pays Rahul'));
  await clickTextLast('Record');
  await sleep(2000);
  const afterSettlement = await text();
  check('Neha → Rahul suggestion cleared', !afterSettlement.includes('Neha → Rahul'));
  check('remaining suggestion is Neha → You', afterSettlement.includes('Neha → You'));

  // 7. The settlement is listed on the Settled tab.
  await clickText('Settled');
  await sleep(1200);
  check('settlement recorded in the list', (await text()).includes('Neha → Rahul'));
  await page.screenshot({ path: 'screenshots/group-settled.png' });

  // 8. Dynamic line items: "Train travel + Hotel stay" as one batch.
  check('third new-expense button found', await clickLabel('New expense in group'));
  await waitForText('Add another expense');
  await typeInto('input[placeholder="0"]', '2400');
  await typeInto('input[placeholder^="e.g. Train travel"]', 'Train travel');
  await clickText('Add another expense');
  await sleep(600);
  check('second item row appears', await typeInto('input[placeholder^="e.g. Hotel stay"]', 'Hotel stay'));
  check('second item amount set', await setInputAt('input[placeholder="0"]', 1, '6000'));
  await sleep(600);
  const batchPreview = await text();
  check('batch total ₹8,400', batchPreview.includes('8,400'));
  check('your share of the batch ₹2,100', batchPreview.includes('2,100'));
  await clickText('Add shared expense');
  await sleep(2000);
  const afterBatch = await text();
  check('group total ₹41,400', afterBatch.includes('41,400'));
  check('your share ₹10,350', afterBatch.includes('10,350'));
  check('you should receive ₹18,050', afterBatch.includes('18,050'));

  // 9. The itemised detail shows both items.
  await clickText('Expenses');
  await sleep(800);
  check('batch title derived from items', (await text()).includes('Train travel +1 more'));
  await clickText('Train travel +1 more');
  await waitForText('ITEMS');
  await sleep(800);
  const detailText = await text();
  check('detail lists Train travel', detailText.includes('Train travel'));
  check('detail lists Hotel stay', detailText.includes('Hotel stay'));
  await page.screenshot({ path: 'screenshots/group-items.png' });
} catch (error) {
  console.error(`Verification failed: ${error instanceof Error ? error.message : error}`);
  failures.push('unexpected error');
}

await browser.close();
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nMulti-payer trip flow verified');
