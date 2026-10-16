import * as SQLite from 'expo-sqlite';
import { drizzle, type ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';

import migrationBundle from './migrations-bundle';
import * as schema from './schema';

export const DATABASE_NAME = 'wallnut.db';

let sqlite: SQLite.SQLiteDatabase | null = null;
let dbInstance: ExpoSQLiteDatabase<typeof schema> | null = null;

export type Database = ExpoSQLiteDatabase<typeof schema>;

/**
 * Opens the database, applies drizzle migrations and derives the analytics
 * views. Must complete before the app renders data. Safe to call twice.
 */
export async function initDatabase(): Promise<Database> {
  if (dbInstance) return dbInstance;

  const handle = await SQLite.openDatabaseAsync(DATABASE_NAME);
  await handle.execAsync('PRAGMA journal_mode = WAL;');
  await handle.execAsync('PRAGMA foreign_keys = ON;');

  const database = drizzle(handle, { schema });
  await migrate(database, {
    journal: migrationBundle.journal as unknown as {
      entries: { idx: number; when: number; tag: string; breakpoints: boolean }[];
    },
    migrations: migrationBundle.migrations,
  });
  await createViews(handle);
  await handle.execAsync('PRAGMA foreign_keys = ON;');

  sqlite = handle;
  dbInstance = database;
  return database;
}

/**
 * The `effective_ledger` view expands split transactions into one row per
 * category so analytics never has to special-case splits. Non-split rows pass
 * through untouched.
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
