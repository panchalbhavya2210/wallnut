import { Directory, File, Paths } from 'expo-file-system';
import { inArray, eq, sql } from 'drizzle-orm';
import { Platform } from 'react-native';

import { getDb } from '@/db/client';
import { transactionAttachments, type TransactionAttachment } from '@/db/schema';
import { notifyDbChanged } from '@/stores/db.store';
import { createId } from '@/utils/id';

/**
 * Receipts & attachments — stored locally, referenced from SQLite.
 *
 * Native: the picked file is copied into the app documents directory so it
 * survives cache cleanups. Web: browsers do not expose a persistent local
 * filesystem, so the blob URL is stored for the current session only (the
 * Android build is the target for receipts).
 */

const ATTACHMENTS_DIR = 'attachments';

function attachmentsDirectory(): Directory {
  return new Directory(Paths.document, ATTACHMENTS_DIR);
}

export function kindForMime(mime: string | null | undefined, filename: string): 'image' | 'pdf' | 'other' {
  const type = (mime ?? '').toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.includes('pdf') || filename.toLowerCase().endsWith('.pdf')) return 'pdf';
  return 'other';
}

export interface PickedFile {
  uri: string;
  name: string;
  mimeType?: string | null;
  size?: number | null;
}

/** Copies the picked file into app storage (native) and records it. */
export async function addAttachment(transactionId: string, picked: PickedFile): Promise<TransactionAttachment> {
  const db = getDb();
  const kind = kindForMime(picked.mimeType, picked.name);
  let storedUri = picked.uri;

  if (Platform.OS !== 'web') {
    try {
      const directory = attachmentsDirectory();
      if (!directory.exists) directory.create({ intermediates: true });
      const extension = picked.name.includes('.') ? picked.name.split('.').pop() : kind === 'image' ? 'jpg' : 'bin';
      const target = new File(directory, `${transactionId}-${createId('att')}.${extension}`);
      const source = new File(picked.uri);
      source.copy(target);
      storedUri = target.uri;
    } catch {
      // Fall back to the original URI — better to keep the reference than fail.
      storedUri = picked.uri;
    }
  }

  const row: TransactionAttachment = {
    id: createId('att'),
    transactionId,
    uri: storedUri,
    kind,
    name: picked.name,
    size: picked.size ?? null,
    createdAt: Date.now(),
  };
  await db.insert(transactionAttachments).values(row);
  notifyDbChanged();
  return row;
}

export async function listAttachments(transactionId: string): Promise<TransactionAttachment[]> {
  const db = getDb();
  return db
    .select()
    .from(transactionAttachments)
    .where(eq(transactionAttachments.transactionId, transactionId));
}

export async function attachmentCounts(transactionIds: string[]): Promise<Record<string, number>> {
  if (transactionIds.length === 0) return {};
  const db = getDb();
  const rows = await db
    .select({ transactionId: transactionAttachments.transactionId, count: sql<number>`count(*)` })
    .from(transactionAttachments)
    .where(inArray(transactionAttachments.transactionId, transactionIds))
    .groupBy(transactionAttachments.transactionId);
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.transactionId] = Number(row.count);
  return counts;
}

export async function deleteAttachment(id: string, removeFile = true): Promise<void> {
  const db = getDb();
  const rows = await db.select().from(transactionAttachments).where(eq(transactionAttachments.id, id)).limit(1);
  const row = rows[0];
  if (row && removeFile && Platform.OS !== 'web') {
    try {
      const file = new File(row.uri);
      if (file.exists) file.delete();
    } catch {
      // File may already be gone.
    }
  }
  await db.delete(transactionAttachments).where(eq(transactionAttachments.id, id));
  notifyDbChanged();
}

/** Deletes attachments when a transaction is removed (user-confirmed). */
export async function deleteAttachmentsForTransaction(transactionId: string, removeFiles = true): Promise<void> {
  const rows = await listAttachments(transactionId);
  for (const row of rows) {
    await deleteAttachment(row.id, removeFiles);
  }
}

export async function countAttachmentsForTransaction(transactionId: string): Promise<number> {
  return (await listAttachments(transactionId)).length;
}

/** Storage footprint of all locally stored receipts. */
export async function attachmentsStorageBytes(): Promise<number> {
  const db = getDb();
  const rows = await db.select({ size: transactionAttachments.size }).from(transactionAttachments);
  return rows.reduce((sum, row) => sum + (row.size ?? 0), 0);
}
