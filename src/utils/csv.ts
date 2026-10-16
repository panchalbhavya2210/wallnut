/**
 * Minimal, dependency-free CSV reader/writer with correct quote handling.
 * Used by the import wizard and the export service.
 */

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  delimiter: string;
}

export function detectDelimiter(sample: string): string {
  const firstLines = sample.split(/\r?\n/).slice(0, 5).join('\n');
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let bestScore = -Infinity;
  for (const delimiter of candidates) {
    const counts = firstLines
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => line.split(delimiter).length - 1);
    if (counts.length === 0) continue;
    const total = counts.reduce((a, b) => a + b, 0);
    // A delimiter that never appears cannot be the delimiter — otherwise a
    // consistent-but-absent character would beat the real one.
    if (total === 0) continue;
    // Prefer a delimiter that appears consistently on every non-empty line.
    const consistent = counts.every((c) => c === counts[0]) ? 10 : 0;
    const score = total + consistent;
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }
  return best;
}

export function parseCsv(text: string, delimiter?: string): ParsedCsv {
  const clean = text.replace(/^\uFEFF/, '');
  const delim = delimiter ?? detectDelimiter(clean);
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === delim) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && clean[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  // Flush trailing field/row.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  }

  if (rows.length === 0) return { headers: [], rows: [], delimiter: delim };
  const [headers, ...body] = rows;
  return {
    headers: headers!.map((h) => h.trim()),
    rows: body,
    delimiter: delim,
  };
}

function escapeCell(value: string | number | null | undefined, delimiter: string): string {
  const text = value == null ? '' : String(value);
  const mustQuote = text.includes('"') || text.includes('\n') || text.includes('\r') || text.includes(delimiter);
  if (!mustQuote) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][], delimiter = ','): string {
  const lines = [headers.map((h) => escapeCell(h, delimiter)).join(delimiter)];
  for (const row of rows) {
    lines.push(row.map((cell) => escapeCell(cell, delimiter)).join(delimiter));
  }
  return lines.join('\n');
}
