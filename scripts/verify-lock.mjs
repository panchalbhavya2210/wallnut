// Interactive verification of the app-lock flow on the exported web build:
// enable lock → set PIN → Lock now → wrong PIN rejected → correct PIN unlocks.
//
//   node scripts/verify-lock.mjs [baseUrl]
import { mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const base = process.argv[2] ?? 'http://localhost:8081';

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];
function check(label, condition) {
  console.log(`${condition ? '✓' : '✗'} ${label}`);
  if (!condition) failures.push(label);
}

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--window-size=390,844', '--disable-gpu', '--no-first-run', '--disable-extensions'],
  // Chrome 154+ rejects setDeviceMetricsOverride from older CDP clients; the
  // window size defines the viewport instead.
  defaultViewport: null,
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.log(`  pageerror: ${error.message}`));

const text = () => page.evaluate(() => document.body.innerText || '');
const clickText = async (label) => {
  const clicked = await page.evaluate((needle) => {
    const candidates = Array.from(document.querySelectorAll('[role="button"], button'));
    const target =
      candidates.find((node) => (node.textContent || '').trim() === needle) ??
      candidates.find((node) => (node.textContent || '').includes(needle));
    if (!target) return false;
    target.click();
    return true;
  }, label);
  await sleep(200);
  return clicked;
};
const pressPin = async (pin) => {
  for (const digit of pin) {
    const ok = await page.evaluate((needle) => {
      const target = document.querySelector(`[aria-label="PIN key ${needle}"]`);
      if (!target) return false;
      target.click();
      return true;
    }, digit);
    if (!ok) throw new Error(`PIN key ${digit} not found`);
    await sleep(120);
  }
};

await page.goto(`${base}/settings/security`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
for (let attempt = 0; attempt < 60; attempt++) {
  if ((await text()).includes('Require unlock')) break;
  await sleep(500);
}

// 1. Enable the lock via the switch.
const toggled = await page.evaluate(() => {
  const target = document.querySelector('input[role="switch"]');
  if (!target) return false;
  target.click();
  return true;
});
check('app-lock switch present and toggled', toggled);
await sleep(600);
check('PIN setup sheet opened', (await text()).includes('Choose a 4-digit PIN'));

// 2. Choose and confirm 1234.
await pressPin('1234');
await sleep(500);
check('PIN confirmation step', (await text()).includes('Confirm your PIN'));
await pressPin('1234');
await sleep(800);
const afterSetup = await text();
check('PIN saved (subtitle shows PIN set)', afterSetup.includes('PIN set'));
await page.screenshot({ path: join(root, 'screenshots', 'security-pin.png') });

// 3. Lock now → lock screen.
await clickText('Lock now');
await sleep(600);
check('lock screen shown', (await text()).includes('Wallnut is locked'));
await page.screenshot({ path: join(root, 'screenshots', 'app-lock.png') });

// 4. Wrong PIN is rejected.
await pressPin('9999');
await sleep(600);
check('wrong PIN rejected', (await text()).includes('Incorrect PIN'));

// 5. Correct PIN unlocks.
await pressPin('1234');
await sleep(800);
check('correct PIN unlocks', !(await text()).includes('Wallnut is locked'));

// 6. Lock again and disable it so the browser keeps a usable state.
await clickText('Lock now');
await sleep(500);
await pressPin('1234');
await sleep(600);
await page.evaluate(() => {
  const target = document.querySelector('input[role="switch"]');
  target?.click();
});
await sleep(600);
const afterDisable = await text();
check('lock disabled clears the PIN', afterDisable.includes('Require unlock') && !afterDisable.includes('PIN set'));

await browser.close();
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nApp-lock flow verified');
