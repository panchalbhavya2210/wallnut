import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

/**
 * Saves a generated file and offers the platform-appropriate way to get it:
 *  - web: triggers a browser download
 *  - native: opens the system share sheet with the file attached
 */
export async function saveAndShareFile(filename: string, content: string, mimeType: string, dialogTitle = 'Save file'): Promise<void> {
  if (Platform.OS === 'web') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return;
  }

  const file = new File(Paths.cache, filename);
  try {
    file.create({ overwrite: true });
  } catch {
    // Already exists — write replaces the contents below.
  }
  file.write(content);

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType, dialogTitle, UTI: mimeType === 'text/csv' ? 'public.comma-separated-values-text' : 'public.json' });
  }
}

export async function readTextFile(uri: string): Promise<string> {
  const file = new File(uri);
  return file.text();
}
