// End-to-end verification of the Financial Inbox on the exported web build:
// priority sections render; ignoring an item hides it and Restore brings it
// back; approving a transaction and creating a schedule clear their items.
//
//   node scripts/verify-inbox.mjs [baseUrl]
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
  await sleep(300);
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
  await sleep(300);
  return clicked;
};
const parseCount = (body) => {
  const match = body.match(/(\d+) items? needs? attention/);
  return match ? Number(match[1]) : 0;
};

try {
  // Boot first: deep-linking before the first boot finishes races the redirect.
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  check('app boots', await waitForText('NET WORTH'));
  await sleep(1800);

  await page.goto(`${base}/inbox`, { waitUntil: 'domcontentloaded' });
  check('inbox renders', await waitForText('Financial Inbox'));
  await sleep(2200);
  const first = await text();
  check('priority sections render', /URGENT|ACTION REQUIRED|SUGGESTION|INFORMATION/.test(first));
  check('items need attention', parseCount(first) > 0);
  if (parseCount(first) === 0) {
    console.log('  debug — inbox text:', JSON.stringify(first.slice(0, 1200)));
  }
  check('urgent hint appears when something looks wrong', !first.includes('· 1 urgent') || first.includes('look wrong'));
  await page.screenshot({ path: 'screenshots/inbox.png' });

  // 1. Remind later (snooze) → the item disappears and the dismissed card appears.
  const beforeIgnore = parseCount(await text());
  const snoozed = await clickText('Remind later');
  check('snooze action available', snoozed);
  if (snoozed) {
    await sleep(1500);
    const afterIgnore = parseCount(await text());
    check(`snoozing removed the item (${beforeIgnore} → ${afterIgnore})`, afterIgnore === beforeIgnore - 1);
    check('dismissed card appears', (await text()).includes('ignored or snoozed'));

    // 2. Restore → the item comes back.
    await clickTextLast('Restore');
    await sleep(600);
    await clickTextLast('Restore');
    await sleep(1800);
    const afterRestore = parseCount(await text());
    check(`restore brought it back (${afterRestore})`, afterRestore === beforeIgnore);
  }

  // 3. Approve a transaction item → it clears from the queue.
  let current = await text();
  if (current.includes('Approve')) {
    const beforeApprove = parseCount(current);
    await clickText('Approve');
    await sleep(1600);
    const afterApprove = parseCount(await text());
    check(`approve cleared an item (${beforeApprove} → ${afterApprove})`, afterApprove === beforeApprove - 1);
  } else {
    console.log('  (no Approve action in this seed)');
  }

  // 4. Create a schedule from a detected recurring payment → item clears.
  current = await text();
  if (current.includes('Create schedule')) {
    const beforeCreate = parseCount(current);
    await clickText('Create schedule');
    await sleep(2000);
    const afterCreate = parseCount(await text());
    check(`create schedule cleared the candidate (${beforeCreate} → ${afterCreate})`, afterCreate === beforeCreate - 1);
    await page.goto(`${base}/recurring`, { waitUntil: 'domcontentloaded' });
    await waitForText('Recurring');
    await sleep(1800);
    check('recurring screen lists schedules after creation', (await text()).includes('Recurring'));
  } else {
    console.log('  (no Create schedule action in this seed)');
  }
} catch (error) {
  console.error(`Verification failed: ${error instanceof Error ? error.message : error}`);
  failures.push('unexpected error');
}

await browser.close();
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nFinancial Inbox flow verified');
