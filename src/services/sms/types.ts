/**
 * Shared SMS-ingestion types. V2 wires bank SMS parsing into the same
 * TransactionImportService pipeline every other source uses.
 */

export interface SmsMessage {
  id: string;
  address: string;
  body: string;
  /** Epoch milliseconds. */
  receivedAt: number;
}

export interface SmsIngestResult {
  available: boolean;
  /** Human-readable reason when unavailable. */
  reason?: string;
  messages: SmsMessage[];
}

export interface SmsImportPreview {
  parsed: number;
  raw: RawSmsRecord[];
}

/** A parsed SMS row, before normalization/validation/dedupe. */
export interface RawSmsRecord {
  sender: string;
  body: string;
  receivedAt: number;
  /** Best-effort extracted fields (filled by the bank-specific parsers in V2). */
  amount?: string;
  accountHint?: string;
  merchant?: string;
  date?: string;
  reference?: string;
  direction?: 'debit' | 'credit';
}
