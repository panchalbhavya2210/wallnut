// Headless UI verification for the exported web build (system Chrome via CDP).
//
//   node scripts/verify-web.mjs <url> <name> [width] [height] [waitForText]
//
// Waits for real time (not virtual time), captures console errors and page
// errors, writes a screenshot to ./screenshots/<name>.png and the DOM to
// .expo/verify/<name>.html. This is the loop used to inspect the UI.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const [url = 'http://localhost:8081', name = 'home', width = '390', height = '844', waitForText = ''] = process.argv.slice(2);

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
mkdirSync(join(root, '.expo', 'verify'), { recursive: true });

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: [`--window-size=${width},${height}`, '--disable-gpu', '--no-first-run', '--disable-extensions'],
  // Chrome 154+ rejects setDeviceMetricsOverride from older CDP clients, so the
  // window size (not emulation) defines the viewport.
  defaultViewport: null,
});

const page = await browser.newPage();
const consoleErrors = [];
const consoleLogs = [];
page.on('console', (message) => {
  const text = `${message.type()}: ${message.text()}`;
  if (message.type() === 'error') consoleErrors.push(text);
  else consoleLogs.push(text);
});
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
page.on('requestfailed', (request) => consoleErrors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ''}`));

const started = Date.now();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });

// Wait for real content: either the expected text, or any of the app's markers.
const markers = [waitForText, 'Good morning', 'Good afternoon', 'Good evening', 'NET WORTH', 'Wallnut', 'Set your currency'].filter(Boolean);
let settled = false;
for (let attempt = 0; attempt < 90 && !settled; attempt++) {
  const body = await page.evaluate(() => document.body.innerText || '');
  if (markers.some((marker) => marker && body.includes(marker))) settled = true;
  else await new Promise((resolve) => setTimeout(resolve, 1000));
}

// Then wait for actual figures: widgets resolve at different times, and a
// screenshot of spinners is worthless. The drawer/count-ups can contain ₹
// before the main widgets have data, so give the screen a beat to settle.
await new Promise((resolve) => setTimeout(resolve, 2500));
for (let attempt = 0; attempt < 30; attempt++) {
  const body = await page.evaluate(() => document.body.innerText || '');
  if (body.includes('₹') || /couldn't start|No spending|No transactions|Nothing to review/i.test(body)) break;
  await new Promise((resolve) => setTimeout(resolve, 500));
}
const elapsed = Date.now() - started;

const bodyText = await page.evaluate(() => document.body.innerText || '');
const html = await page.content();
writeFileSync(join(root, '.expo', 'verify', `${name}.html`), html, 'utf8');
await page.screenshot({ path: join(root, 'screenshots', `${name}.png`), fullPage: false });
await browser.close();

const checks = {
  'unmatched route': /Unmatched Route/i.test(bodyText),
  'boot error screen': /couldn't start/i.test(bodyText),
  'still booting': bodyText.trim() === 'W WALLNUT' || bodyText.trim() === 'WALLNUT',
  onboarding: /Set your currency|Get started/i.test(bodyText),
  'dashboard greeting': /Good (morning|afternoon|evening|night)/i.test(bodyText),
  'dashboard content': /NET WORTH|CASH FLOW|SPENDING|BUDGETS|INSIGHTS/i.test(bodyText),
  'tab bar': /Home[\s\S]{0,200}Transactions[\s\S]{0,200}Analytics[\s\S]{0,200}More/i.test(bodyText),
};

console.log(`URL         ${url}`);
console.log(`viewport    ${width}x${height}`);
console.log(`settled     ${settled ? `yes in ${elapsed}ms` : `NO (waited ${elapsed}ms)`}`);
console.log(`screenshot  screenshots/${name}.png`);
for (const [label, pass] of Object.entries(checks)) console.log(`${pass ? '✓' : '·'} ${label}`);
if (consoleErrors.length > 0) {
  console.log('\nCONSOLE ERRORS:');
  for (const line of consoleErrors.slice(0, 12)) console.log(`  ${line.slice(0, 220)}`);
}
const bootLogs = consoleLogs.filter((line) => line.includes('[boot]'));
if (bootLogs.length > 0) {
  console.log('\nBOOT TIMING:');
  for (const line of bootLogs) console.log(`  ${line.replace(/^log: /, '')}`);
}
console.log('\nVISIBLE TEXT (first 400 chars):');
console.log(bodyText.slice(0, 400).replace(/\n+/g, ' | '));
