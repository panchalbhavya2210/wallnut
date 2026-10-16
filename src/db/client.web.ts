import * as SQLite from 'expo-sqlite';
import { drizzle } from 'drizzle-orm/sqlite-proxy';

import migrationBundle from './migrations-bundle';
import * as schema from './schema';

/**
 * Web database driver.
 *
 * expo-sqlite's web implementation exposes two APIs: an async one that posts
 * messages to its SQLite worker, and a synchronous one built on a
 * SharedArrayBuffer handshake. The sync bridge truncates larger results in the
 * browser (drizzle's Expo driver is sync-only, which made every query risky),
 * so on web Wallnut drives Drizzle through the *async* API via
 * `drizzle-orm/sqlite-proxy` instead. Same schema, same migrations, same
 * services — only the transport differs.
 *
 * Android/iOS keep the native sync driver (see client.ts).
 */

export const DATABASE_NAME = 'wallnut.db';

/** Mirrors the native client's type so service code is platform-agnostic. */
export type Database = ReturnType<typeof drizzle<typeof schema>>;

let sqlite: SQLite.SQLiteDatabase | null = null;
let dbInstance: Database | null = null;

export async function initDatabase(): Promise<Database> {
  if (dbInstance) return dbInstance;

  const handle = await SQLite.openDatabaseAsync(DATABASE_NAME);
  try {
    await handle.execAsync('PRAGMA journal_mode = WAL;');
  } catch {
    // Some web VFS builds do not implement WAL — not fatal.
  }
  await handle.execAsync('PRAGMA foreign_keys = ON;');

  await applyMigrations(handle);
  await createViews(handle);

  const database = drizzle(
    async (sql, params, method) => execute(handle, sql, params, method),
    { schema },
  );

  sqlite = handle;
  dbInstance = database;
  return database;
}

/**
 * Applies drizzle-generated migrations without drizzle's own migrator (which
 * expects the Expo sync driver).
 *
 * Two layers of safety, because a database may already exist in the browser:
 *  1. bookkeeping lives in `__wallnut_migrations`; a legacy `__drizzle_migrations`
 *     table (from the native driver) is adopted instead of re-running migrations
 *  2. each statement tolerates "already exists" / "duplicate column" errors, so
 *     upgrades from any earlier state converge instead of failing to boot
 */
async function applyMigrations(handle: SQLite.SQLiteDatabase): Promise<void> {
  await handle.execAsync(
    `CREATE TABLE IF NOT EXISTS __wallnut_migrations (
      tag text PRIMARY KEY NOT NULL,
      applied_at integer NOT NULL
    );`,
  );

  const appliedRows = await handle.getAllAsync<{ tag: string }>('SELECT tag FROM __wallnut_migrations');
  const applied = new Set(appliedRows.map((row) => row.tag));

  // Adopt a database created by the native driver's migrator.
  if (applied.size === 0) {
    const legacy = await handle
      .getAllAsync<{ count: number }>(
        `SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'`,
      )
      .catch(() => [{ count: 0 }]);
    if (Number(legacy[0]?.count ?? 0) > 0) {
      const entries = await handle
        .getAllAsync<{ created_at: number }>('SELECT created_at FROM __drizzle_migrations')
        .catch(() => []);
      if (entries.length > 0) {
        for (const entry of migrationBundle.journal.entries.slice(0, entries.length)) {
          await handle.runAsync('INSERT OR IGNORE INTO __wallnut_migrations (tag, applied_at) VALUES (?, ?)', [
            entry.tag,
            Date.now(),
          ]);
          applied.add(entry.tag);
        }
      }
    }
  }

  for (const entry of migrationBundle.journal.entries) {
    if (applied.has(entry.tag)) continue;
    const key = `m${String(entry.idx).padStart(4, '0')}`;
    const sql = migrationBundle.migrations[key];
    if (!sql) throw new Error(`Missing migration SQL for ${entry.tag}`);

    for (const statement of sql.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed.length === 0) continue;
      try {
        await handle.execAsync(trimmed);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const alreadyApplied = /already exists|duplicate column name/i.test(message);
        if (!alreadyApplied) throw error;
      }
    }
    await handle.runAsync('INSERT OR IGNORE INTO __wallnut_migrations (tag, applied_at) VALUES (?, ?)', [
      entry.tag,
      Date.now(),
    ]);
  }
}

/**
 * Translates a Drizzle query into an expo-sqlite async call. Drizzle expects
 * positional row arrays, so object rows are converted with Object.values (the
 * column order of getAllAsync matches the SELECT list).
 */
async function execute(
  handle: SQLite.SQLiteDatabase,
  sql: string,
  params: unknown[],
  method: 'run' | 'all' | 'get' | 'values',
): Promise<{ rows: unknown[] }> {
  if (method === 'run') {
    await handle.runAsync(sql, (params ?? []) as never);
    return { rows: [] };
  }

  const rows = await handle.getAllAsync<Record<string, unknown>>(sql, (params ?? []) as never);
  const positional = rows.map((row) => Object.values(row));
  if (method === 'get') {
    return { rows: positional.length > 0 ? [positional[0]!] : [] };
  }
  return { rows: positional };
}

/**
 * The `effective_ledger` view expands split transactions into one row per
 * category so analytics never has to special-case splits.
 */
async function createViews(handle: SQLite.SQLiteDatabase): Promise<void> {
  await handle.execAsync(`
    CREATE VIEW IF NOT EXISTS effective_ledger AS
      SELECT
        t.id            AS transaction_id,
        t.date          AS date,
        t.account_id    AS account_id,
        t.type          AS type,
        s.category_id   AS category_id,
        s.amount        AS amount
      FROM transactions t
      JOIN transaction_splits s ON s.transaction_id = t.id
      UNION ALL
      SELECT
        t.id            AS transaction_id,
        t.date          AS date,
        t.account_id    AS account_id,
        t.type          AS type,
        t.category_id   AS category_id,
        t.amount        AS amount
      FROM transactions t
      WHERE NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id);
  `);
}

export function getDb(): Database {
  if (!dbInstance) throw new Error('Database not initialised — call initDatabase() first.');
  return dbInstance;
}

export function getSqlite(): SQLite.SQLiteDatabase {
  if (!sqlite) throw new Error('Database not initialised — call initDatabase() first.');
  return sqlite;
}

export { schema };
