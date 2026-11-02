/**
 * Client-side CSV export of the table on screen. Cells that start with = + - @ (or tab/CR) are
 * prefixed with a quote so spreadsheet apps never run them as formulas (CSV injection).
 */
export type CsvCell = string | number | boolean | null | undefined;

export function csvCell(v: CsvCell): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(head: readonly string[], rows: ReadonlyArray<readonly CsvCell[]>): string {
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

/** Download as a UTF-8 file (BOM so Excel shows ₹ and Hindi names correctly). */
export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
