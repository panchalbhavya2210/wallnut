import type { SmsIngestResult, SmsMessage, SmsImportPreview } from './types';

/**
 * Android/iOS SMS source. V2 will read bank SMS (with READ_SMS permission on
 * Android) and hand the messages to the shared import pipeline. V1 ships the
 * interface only — nothing is read, nothing is faked.
 */

export function isSmsAvailable(): boolean {
  return false; // flips to true in V2 once the native reader is configured.
}

export async function requestSmsPermission(): Promise<boolean> {
  // V2: PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_SMS)
  return false;
}

export async function readRecentBankSms(): Promise<SmsIngestResult> {
  return {
    available: false,
    reason: 'Bank SMS import is planned for a future version of Wallnut.',
    messages: [],
  };
}

export async function previewSmsImport(_messages: SmsMessage[]): Promise<SmsImportPreview> {
  return { parsed: 0, raw: [] };
}

export const SMS_PIPELINE_NOTE =
  'Bank SMS parsing feeds the shared import pipeline: Raw → Normalizer → Validator → Duplicate Detector → Transaction Service.';
