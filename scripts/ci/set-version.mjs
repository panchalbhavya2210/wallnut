// Sets the Android versionCode + versionName for a CI build.
//
//   BUILD_NUMBER=42 node scripts/ci/set-version.mjs
//
// versionCode becomes the workflow run number (unique and strictly increasing)
// and versionName becomes "<app.json version>+b<run>", so every APK can be
// traced back to the exact build that produced it. Runs before `expo prebuild`.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const buildNumber = process.env.BUILD_NUMBER ?? '';
if (!/^[1-9]\d*$/.test(buildNumber)) {
  console.error(`BUILD_NUMBER must be a positive integer (got ${JSON.stringify(buildNumber)})`);
  process.exit(1);
}

const appJsonPath = fileURLToPath(new URL('../../app.json', import.meta.url));
const app = JSON.parse(readFileSync(appJsonPath, 'utf8'));
const baseVersion = String(app.expo.version).split('+')[0];

app.expo.version = `${baseVersion}+b${buildNumber}`;
app.expo.android = { ...(app.expo.android ?? {}), versionCode: Number(buildNumber) };

writeFileSync(appJsonPath, `${JSON.stringify(app, null, 2)}\n`);
console.log(`Version ${app.expo.version} (versionCode ${app.expo.android.versionCode})`);
