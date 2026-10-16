// Wallnut — Metro configuration
// expo-sqlite's web worker imports wa-sqlite's .wasm binary, so Metro must treat
// .wasm as an asset. Keep this config to the absolute minimum: overriding the
// dev-server middleware or the Babel transformer breaks Metro's worker chunk
// serialization ("Worker chunk not found").
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('wasm');

module.exports = config;
