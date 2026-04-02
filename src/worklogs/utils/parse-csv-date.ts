/**
 * Flexible date parser for CSV worklog imports.
 *
 * Supported formats (hyphens / spaces only — slashes are rejected):
 *   1. YYYY-MM-DD         ISO Standard        (2026-03-27)
 *   2. DD-MM-YYYY         International Full   (27-03-2026)
 *   3. DD-MM-YY           International Short  (27-03-26)
 *   4. MM-DD-YYYY         US Full              (03-27-2026)
 *   5. MM-DD-YY           US Short             (03-27-26)
 *   6. D MMMM YYYY        Natural Language     (27th March 2026 / 27th March, 2026)
 *
 * When `format` is provided, parsing is strict — only that format is tried.
 * When omitted, auto-detection is used with International (DD-MM) as the
 * ambiguity default.
 *
 * Returns YYYY-MM-DD string or null if unparseable.
 */

export type CsvDateFormat =
  | 'YYYY-MM-DD'
  | 'DD-MM-YYYY'
  | 'DD-MM-YY'
  | 'MM-DD-YYYY'
  | 'MM-DD-YY'
  | 'D MMMM YYYY';

export const CSV_DATE_FORMATS: { value: CsvDateFormat; label: string; example: string }[] = [
  { value: 'YYYY-MM-DD', label: 'ISO Standard', example: '2026-03-27' },
  { value: 'DD-MM-YYYY', label: 'International Full', example: '27-03-2026' },
  { value: 'DD-MM-YY', label: 'International Short', example: '27-03-26' },
  { value: 'MM-DD-YYYY', label: 'US Full', example: '03-27-2026' },
  { value: 'MM-DD-YY', label: 'US Short', example: '03-27-26' },
  { value: 'D MMMM YYYY', label: 'Natural Language', example: '27th March 2026' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

const MONTH_NAMES: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

const MONTH_FULL_NAMES = [
  '',
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function expandYear(yy: number): number {
  return yy < 50 ? 2000 + yy : 1900 + yy;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function isValidDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function toIso(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

// ── Regexes ──────────────────────────────────────────────────────────────────

const NATURAL_RE = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+),?\s+(\d{4})$/i;
const NUMERIC_RE = /^(\d{2,4})-(\d{1,2})-(\d{2,4})$/;
const SLASH_RE = /\//;

// ── Strict parsers (one per format) ──────────────────────────────────────────

function parseIso(input: string): string | null {
  const m = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, ys, ms, ds] = m;
  const year = parseInt(ys, 10),
    month = parseInt(ms, 10),
    day = parseInt(ds, 10);
  return isValidDate(year, month, day) ? toIso(year, month, day) : null;
}

function parseDdMmYyyy(input: string): string | null {
  const m = input.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  const day = parseInt(m[1], 10),
    month = parseInt(m[2], 10),
    year = parseInt(m[3], 10);
  return isValidDate(year, month, day) ? toIso(year, month, day) : null;
}

function parseDdMmYy(input: string): string | null {
  const m = input.match(/^(\d{2})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const day = parseInt(m[1], 10),
    month = parseInt(m[2], 10),
    year = expandYear(parseInt(m[3], 10));
  return isValidDate(year, month, day) ? toIso(year, month, day) : null;
}

function parseMmDdYyyy(input: string): string | null {
  const m = input.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  const month = parseInt(m[1], 10),
    day = parseInt(m[2], 10),
    year = parseInt(m[3], 10);
  return isValidDate(year, month, day) ? toIso(year, month, day) : null;
}

function parseMmDdYy(input: string): string | null {
  const m = input.match(/^(\d{2})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const month = parseInt(m[1], 10),
    day = parseInt(m[2], 10),
    year = expandYear(parseInt(m[3], 10));
  return isValidDate(year, month, day) ? toIso(year, month, day) : null;
}

function parseNatural(input: string): string | null {
  const m = input.match(NATURAL_RE);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = MONTH_NAMES[m[2].toLowerCase()];
  const year = parseInt(m[3], 10);
  if (!month) return null;
  return isValidDate(year, month, day) ? toIso(year, month, day) : null;
}

const STRICT_PARSERS: Record<CsvDateFormat, (input: string) => string | null> = {
  'YYYY-MM-DD': parseIso,
  'DD-MM-YYYY': parseDdMmYyyy,
  'DD-MM-YY': parseDdMmYy,
  'MM-DD-YYYY': parseMmDdYyyy,
  'MM-DD-YY': parseMmDdYy,
  'D MMMM YYYY': parseNatural,
};

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a date string into YYYY-MM-DD.
 *
 * @param raw   The raw date value from the CSV cell.
 * @param format  When provided, parsing is strict (only that format is tried).
 *                When omitted, auto-detects with DD-MM as ambiguity default.
 */
export function parseCsvDate(raw: string, format?: CsvDateFormat): string | null {
  const input = raw.trim();
  if (!input) return null;
  if (SLASH_RE.test(input)) return null;

  // ── Strict mode ──
  if (format) {
    return STRICT_PARSERS[format](input);
  }

  // ── Auto-detect mode (legacy / backward-compat) ──
  const nlResult = parseNatural(input);
  if (nlResult) return nlResult;

  const numMatch = input.match(NUMERIC_RE);
  if (!numMatch) return null;

  const a = parseInt(numMatch[1], 10);
  const b = parseInt(numMatch[2], 10);
  const c = parseInt(numMatch[3], 10);

  // YYYY-MM-DD (first segment is 4 digits)
  if (numMatch[1].length === 4) {
    return isValidDate(a, b, c) ? toIso(a, b, c) : null;
  }

  // ??-??-YYYY or ??-??-YY
  const year = numMatch[3].length === 4 ? c : expandYear(c);
  const ddMmValid = isValidDate(year, b, a);
  const mmDdValid = isValidDate(year, a, b);

  if (ddMmValid && mmDdValid) return toIso(year, b, a); // ambiguous → International
  if (ddMmValid) return toIso(year, b, a);
  if (mmDdValid) return toIso(year, a, b);

  return null;
}

// ── Format a Date as a specific CSV format (for template generation) ─────────

export function formatDateForCsv(date: Date, format: CsvDateFormat): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  const yy = y % 100;

  switch (format) {
    case 'YYYY-MM-DD':
      return toIso(y, m, d);
    case 'DD-MM-YYYY':
      return `${pad2(d)}-${pad2(m)}-${y}`;
    case 'DD-MM-YY':
      return `${pad2(d)}-${pad2(m)}-${pad2(yy)}`;
    case 'MM-DD-YYYY':
      return `${pad2(m)}-${pad2(d)}-${y}`;
    case 'MM-DD-YY':
      return `${pad2(m)}-${pad2(d)}-${pad2(yy)}`;
    case 'D MMMM YYYY': {
      const suffix =
        d === 1 || d === 21 || d === 31
          ? 'st'
          : d === 2 || d === 22
            ? 'nd'
            : d === 3 || d === 23
              ? 'rd'
              : 'th';
      return `${d}${suffix} ${MONTH_FULL_NAMES[m]} ${y}`;
    }
  }
}
