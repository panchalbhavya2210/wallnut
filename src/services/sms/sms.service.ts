import type { SmsIngestResult, SmsMessage, SmsImportPreview } from './types';

/**
 * Default SMS source (fallback). Keep this file's API identical to
 * `sms.service.native.ts` and `sms.service.web.ts` — Metro picks the platform
 * variant at bundle time, TypeScript reads this one.
 */

export function isSmsAvailable(): boolean {
  return false;
}

export async function requestSmsPermission(): Promise<boolean> {
  return false;
}

export async function readRecentBankSms(): Promise<SmsIngestResult> {
  return { available: false, reason: 'SMS ingestion arrives in a future version.', messages: [] };
}

export async function previewSmsImport(_messages: SmsMessage[]): Promise<SmsImportPreview> {
  return { parsed: 0, raw: [] };
}

/**
 * SMS will plug into TransactionImportService (normalize → validate → dedupe →
 * commit) exactly like CSV. No special-cased insertion path exists.
 */
export const SMS_PIPELINE_NOTE =
  'Bank SMS parsing feeds the shared import pipeline: Raw → Normalizer → Validator → Duplicate Detector → Transaction Service.';
