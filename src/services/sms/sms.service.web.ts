import type { SmsIngestResult, SmsMessage, SmsImportPreview } from './types';

/** Web has no SMS capability. Kept so the same imports compile everywhere. */

export function isSmsAvailable(): boolean {
  return false;
}

export async function requestSmsPermission(): Promise<boolean> {
  return false;
}

export async function readRecentBankSms(): Promise<SmsIngestResult> {
  return { available: false, reason: 'SMS import is only available in the Android app.', messages: [] };
}

export async function previewSmsImport(_messages: SmsMessage[]): Promise<SmsImportPreview> {
  return { parsed: 0, raw: [] };
}

export const SMS_PIPELINE_NOTE =
  'Bank SMS parsing feeds the shared import pipeline: Raw → Normalizer → Validator → Duplicate Detector → Transaction Service.';
