// Pure date/time formatting for the /date, /datetime slash commands.
// No DOM, no TipTap, no vscode imports. The clock is always injected via a
// `Date` parameter — never call `Date.now()` / `new Date()` inside this file.

const MONTH_NAMES = [
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

// Warn at most once per distinct invalid time zone value, no matter how many
// times resolveTimeZone/formatSlashDate are called with it.
const warnedInvalidTimeZones = new Set<string>();

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * Resolve a raw `mikedown.slashCommands.timeZone` setting value.
 *
 * - `"local"` or empty/whitespace-only → `undefined` (use the system's local
 *   time zone — i.e. pass `undefined` as `Intl.DateTimeFormat`'s `timeZone`).
 * - `"UTC"` or any other valid IANA zone name → returned unchanged.
 * - Anything `Intl.DateTimeFormat` rejects → `undefined`, plus one
 *   `console.warn` per distinct bad value (not once per call).
 */
export function resolveTimeZone(value: string | null | undefined): string | undefined {
  const trimmed = (value ?? '').trim();
  if (trimmed === '' || trimmed.toLowerCase() === 'local') {
    return undefined;
  }

  try {
    // Constructing the formatter is how Intl validates the zone name; it
    // throws a RangeError for anything it doesn't recognize.
    new Intl.DateTimeFormat(undefined, { timeZone: trimmed });
    return trimmed;
  } catch {
    if (!warnedInvalidTimeZones.has(trimmed)) {
      warnedInvalidTimeZones.add(trimmed);
      console.warn(
        `MikeDown: "${trimmed}" is not a valid time zone (mikedown.slashCommands.timeZone). Falling back to local time.`,
      );
    }
    return undefined;
  }
}

function datePartsToMap(parts: Intl.DateTimeFormatPart[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }
  return map;
}

function getDateParts(now: Date, timeZone: string | undefined): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const map = datePartsToMap(formatter.formatToParts(now));
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day) };
}

function getTimeParts(now: Date, timeZone: string | undefined): { hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    // en-US defaults hour12:false to the h24 cycle (midnight rendered as
    // "24"), not the h23 cycle we want (midnight rendered as "00"). Force it.
    hourCycle: 'h23',
  });
  const map = datePartsToMap(formatter.formatToParts(now));
  return { hour: Number(map.hour), minute: Number(map.minute) };
}

function getZoneLabel(now: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    timeZoneName: 'short',
  });
  const part = formatter.formatToParts(now).find((p) => p.type === 'timeZoneName');
  return part ? part.value : '';
}

export interface FormatSlashDateOptions {
  /** `iso` → 2026-09-26. `long` → September 26, 2026 (en-US month name). */
  format: 'iso' | 'long';
  /** Raw setting value: `"local"`, `"UTC"`, an IANA zone name, or empty/invalid (falls back to local). */
  timeZone: string;
  /** When true, append ` HH:mm` (24-hour) and, for non-local zones, a short zone label. */
  includeTime: boolean;
}

/**
 * Format `now` for insertion by /date or /datetime, per the current
 * `dateFormat`/`timeZone` settings. Pure: `now` is always the caller's clock.
 */
export function formatSlashDate(now: Date, opts: FormatSlashDateOptions): string {
  const resolvedTimeZone = resolveTimeZone(opts.timeZone);
  const { year, month, day } = getDateParts(now, resolvedTimeZone);

  const datePart =
    opts.format === 'long' ? `${MONTH_NAMES[month - 1]} ${day}, ${year}` : `${year}-${pad2(month)}-${pad2(day)}`;

  if (!opts.includeTime) {
    return datePart;
  }

  const { hour, minute } = getTimeParts(now, resolvedTimeZone);
  const timePart = `${pad2(hour)}:${pad2(minute)}`;
  const zoneSuffix = resolvedTimeZone ? ` ${getZoneLabel(now, resolvedTimeZone)}` : '';

  return `${datePart} ${timePart}${zoneSuffix}`;
}
