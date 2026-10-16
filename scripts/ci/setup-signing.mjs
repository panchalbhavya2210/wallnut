// Wires release signing into a freshly generated android/ project (run after
// `npx expo prebuild --platform android`). Mirrors what scripts/build-apk.ps1
// does for local builds:
//
//   1. writes android/app/wallnut-release.keystore from WALLNUT_KEYSTORE_BASE64
//      (the existing file wins when present),
//   2. adds the WALLNUT_* signing properties to android/gradle.properties and
//      raises the Gradle heap (the New Architecture C++ build needs >2 GB),
//   3. patches android/app/build.gradle to sign release builds with them.
//
// Required in CI: WALLNUT_KEYSTORE_BASE64 (base64 of the keystore).
// Optional, defaults match scripts/build-apk.ps1: WALLNUT_STORE_PASSWORD,
// WALLNUT_KEY_ALIAS, WALLNUT_KEY_PASSWORD.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const appGradlePath = fileURLToPath(new URL('../../android/app/build.gradle', import.meta.url));
const propsPath = fileURLToPath(new URL('../../android/gradle.properties', import.meta.url));
const keystorePath = fileURLToPath(new URL('../../android/app/wallnut-release.keystore', import.meta.url));

function fail(message) {
  console.error(`setup-signing: ${message}`);
  process.exit(1);
}

// 1. Keystore.
if (!existsSync(keystorePath)) {
  const encoded = (process.env.WALLNUT_KEYSTORE_BASE64 ?? '').replace(/\s+/g, '');
  if (!encoded) {
    fail(
      'android/app/wallnut-release.keystore is missing and WALLNUT_KEYSTORE_BASE64 is not set.\n' +
        'Add the signing secrets first (repo -> Settings -> Secrets and variables -> Actions):\n' +
        '  WALLNUT_KEYSTORE_BASE64  base64 of android/app/wallnut-release.keystore\n' +
        '  WALLNUT_STORE_PASSWORD   keystore password\n' +
        '  WALLNUT_KEY_ALIAS        key alias (wallnut)\n' +
        '  WALLNUT_KEY_PASSWORD     key password'
    );
  }
  const keystore = Buffer.from(encoded, 'base64');
  if (keystore.length < 1024) {
    fail('WALLNUT_KEYSTORE_BASE64 does not look like a keystore file');
  }
  writeFileSync(keystorePath, keystore);
  console.log('Wrote android/app/wallnut-release.keystore from WALLNUT_KEYSTORE_BASE64');
} else {
  console.log('Using the existing android/app/wallnut-release.keystore');
}

// 2. gradle.properties.
let props = readFileSync(propsPath, 'utf8');
props = props.replace(
  /^org\.gradle\.jvmargs=.*$/m,
  'org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m'
);
if (!props.includes('WALLNUT_STORE_FILE')) {
  props +=
    '\n# Release signing (wired by scripts/ci/setup-signing.mjs).\n' +
    'WALLNUT_STORE_FILE=wallnut-release.keystore\n' +
    `WALLNUT_KEY_ALIAS=${process.env.WALLNUT_KEY_ALIAS ?? 'wallnut'}\n` +
    `WALLNUT_STORE_PASSWORD=${process.env.WALLNUT_STORE_PASSWORD ?? 'wallnut-release'}\n` +
    `WALLNUT_KEY_PASSWORD=${process.env.WALLNUT_KEY_PASSWORD ?? 'wallnut-release'}\n`;
}
writeFileSync(propsPath, props);

// 3. app/build.gradle.
let gradle = readFileSync(appGradlePath, 'utf8');
if (gradle.includes('WALLNUT_STORE_FILE')) {
  console.log('android/app/build.gradle already references WALLNUT_STORE_FILE');
} else {
  const eol = gradle.includes('\r\n') ? '\r\n' : '\n';
  const signingAnchor = `    signingConfigs {${eol}        debug {`;
  const signingBlock = [
    '    signingConfigs {',
    '        // Release signing - values live in gradle.properties.',
    '        release {',
    '            storeFile file(WALLNUT_STORE_FILE)',
    '            storePassword WALLNUT_STORE_PASSWORD',
    '            keyAlias WALLNUT_KEY_ALIAS',
    '            keyPassword WALLNUT_KEY_PASSWORD',
    '        }',
    '        debug {',
  ].join(eol);
  if (!gradle.includes(signingAnchor)) {
    fail('could not find the signingConfigs block in android/app/build.gradle');
  }
  gradle = gradle.replace(signingAnchor, signingBlock);

  const releaseAnchor = `            signingConfig signingConfigs.debug${eol}            def enableShrinkResources`;
  if (!gradle.includes(releaseAnchor)) {
    fail('could not find the release build type in android/app/build.gradle');
  }
  gradle = gradle.replace(
    releaseAnchor,
    `            signingConfig signingConfigs.release${eol}            def enableShrinkResources`
  );

  writeFileSync(appGradlePath, gradle);
  console.log('Wired release signing into android/app/build.gradle');
}

console.log('Release signing ready.');
