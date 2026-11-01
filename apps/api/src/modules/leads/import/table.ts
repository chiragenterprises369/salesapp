import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { AppException } from '../../../common/errors/app-exception.js';

/** Upload limits for lead imports. */
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 20_000;

export type TableKind = 'csv' | 'xlsx';
export interface Table {
  columns: string[];
  rows: Array<Record<string, string>>;
}

const invalid = (message: string) => new AppException('IMPORT_INVALID_FILE', message);

/** Decide the parser from the file name, then the content (XLSX files are ZIP archives starting with "PK"). */
export function detectKind(fileName: string, buffer: Buffer): TableKind {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  const isZip = buffer.length > 3 && buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (ext === 'xls') throw invalid('Old .xls files are not supported. Save the file as .xlsx or .csv and upload again.');
  if (ext === 'xlsx') {
    if (!isZip) throw invalid('This .xlsx file is damaged. Save it again and upload.');
    return 'xlsx';
  }
  if (ext === 'csv' || ext === 'txt' || ext === 'tsv') return 'csv';
  if (isZip) return 'xlsx';
  if (buffer.includes(0)) throw invalid('Upload a CSV or Excel (.xlsx) file.');
  return 'csv';
}

/** Unique, non-empty column names ("Phone", "Phone (2)", "Column 3"). */
function uniqueColumns(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((raw, i) => {
    const base = raw.trim().slice(0, 100) || `Column ${i + 1}`;
    const n = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), n);
    return n === 1 ? base : `${base} (${n})`;
  });
}

function checkSize(rows: number): void {
  if (rows === 0) throw invalid('The file has no data rows. Add a header row and at least one lead.');
  if (rows > IMPORT_MAX_ROWS) throw invalid(`The file has more than ${IMPORT_MAX_ROWS.toLocaleString('en-IN')} rows. Split it into smaller files.`);
}

export function parseCsv(buffer: Buffer): Table {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const headerNames: string[] = [];
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => {
      headerNames.push(h);
      return uniqueColumns(headerNames).at(-1)!;
    },
  });
  const columns = result.meta.fields ?? [];
  if (!columns.length) throw invalid('The file has no header row.');
  const rows = result.data
    .map((r) => Object.fromEntries(columns.map((c) => [c, typeof r[c] === 'string' ? r[c].trim() : ''])))
    .filter((r) => Object.values(r).some((v) => v !== ''));
  checkSize(rows.length);
  return { columns, rows };
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('hyperlink' in v) return String(v.text ?? v.hyperlink ?? '');
    if ('formula' in v || 'sharedFormula' in v) return cellText((v as { result?: ExcelJS.CellValue }).result ?? null);
    if ('error' in v) return '';
    return '';
  }
  return String(v);
}

export async function parseXlsx(buffer: Buffer): Promise<Table> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw invalid('This Excel file could not be read. Save it as .xlsx or .csv and upload again.');
  }
  const ws = wb.worksheets.find((s) => s.actualRowCount > 0);
  if (!ws) throw invalid('The workbook is empty.');
  if (ws.actualRowCount - 1 > IMPORT_MAX_ROWS) checkSize(ws.actualRowCount - 1);

  const header = ws.getRow(1);
  const raw: string[] = [];
  for (let c = 1; c <= header.cellCount; c++) raw.push(cellText(header.getCell(c).value).trim());
  while (raw.length && raw.at(-1) === '') raw.pop();
  if (!raw.length) throw invalid('The first row must contain column names.');
  const columns = uniqueColumns(raw);

  const rows: Array<Record<string, string>> = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (n === 1) return;
    const rec: Record<string, string> = {};
    columns.forEach((col, i) => (rec[col] = cellText(row.getCell(i + 1).value).trim()));
    if (Object.values(rec).some((v) => v !== '')) rows.push(rec);
  });
  checkSize(rows.length);
  return { columns, rows };
}

export async function parseTable(fileName: string, buffer: Buffer): Promise<Table> {
  return detectKind(fileName, buffer) === 'xlsx' ? parseXlsx(buffer) : parseCsv(buffer);
}
