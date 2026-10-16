// Minimal static server for the exported web build (dist/).
//
//   node scripts/serve-web.mjs [port] [--memory]
//
// Default sends COOP/COEP headers so the browser is cross-origin isolated:
// expo-sqlite needs SharedArrayBuffer for the synchronous queries Drizzle uses,
// and isolation also enables OPFS persistence. Pass --memory to skip the
// headers (faster paint, but the database cannot open on web).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(dirname(fileURLToPath(import.meta.url))), 'dist');
const args = process.argv.slice(2);
const isolated = !args.includes('--memory');
const port = Number(args.find((arg) => !arg.startsWith('--')) || 8081);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

if (!existsSync(root)) {
  console.error(`No web build found at ${root}. Run: npx expo export --platform web`);
  process.exit(1);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';

    let filePath = join(root, pathname);
    if (!filePath.startsWith(root)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    // SPA fallback: unknown paths serve index.html (expo-router client routing).
    try {
      const info = await stat(filePath);
      if (info.isDirectory()) filePath = join(filePath, 'index.html');
    } catch {
      filePath = join(root, 'index.html');
    }

    const body = await readFile(filePath);
    if (isolated) {
      res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', MIME[extname(filePath)] ?? 'application/octet-stream');
    res.writeHead(200).end(body);
  } catch (error) {
    res.writeHead(500).end(`Server error: ${error instanceof Error ? error.message : String(error)}`);
  }
});

server.listen(port, () => {
  console.log(`Wallnut web build served at http://localhost:${port}`);
  console.log(
    isolated
      ? 'Isolation headers ON — SQLite persists via OPFS (slower first launch).'
      : 'Isolation headers OFF — SQLite runs in memory for a fast preview (data resets on refresh).',
  );
});
