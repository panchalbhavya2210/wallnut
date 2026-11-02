import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

export interface SavedFile {
  filename: string;
  uri: string;
  /** Byte length actually on disk / in the browser blob. */
  bytes: number;
  /** False only on native when the platform has no share sheet. */
  shared: boolean;
}

/**
 * Writes a generated export and only resolves after the file exists with
 * content. On web it triggers a download; on native it opens the system share
 * sheet. Callers must report success from this result — never from a button tap.
 */
export async function saveAndShareFile(
  filename: string,
  content: string,
  mimeType: string,
  dialogTitle = 'Save file',
): Promise<SavedFile> {
  if (Platform.OS === 'web') {
    const blob = new Blob([content], { type: mimeType });
    if (blob.size === 0) throw new Error('The export was empty — nothing was saved.');
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return { filename, uri: filename, bytes: blob.size, shared: true };
  }

  const file = new File(Paths.cache, filename);
  try {
    file.create({ overwrite: true });
  } catch {
    // Already exists — write replaces the contents below.
  }
  file.write(content);
  // Verify the bytes landed on disk before anyone claims the export worked.
  if (!file.exists || file.size <= 0) {
    throw new Error('The export file could not be written. Check storage space and try again.');
  }

  const available = await Sharing.isAvailableAsync();
  if (!available) {
    return { filename, uri: file.uri, bytes: file.size, shared: false };
  }
  await Sharing.shareAsync(file.uri, {
    mimeType,
    dialogTitle,
    UTI: mimeType === 'text/csv' ? 'public.comma-separated-values-text' : 'public.json',
  });
  return { filename, uri: file.uri, bytes: file.size, shared: true };
}

export async function readTextFile(uri: string): Promise<string> {
  const file = new File(uri);
  return file.text();
}
