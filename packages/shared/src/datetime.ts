/**
 * Time for the NFC Mini ERP.
 *
 * Convention A7: timestamps are stored in UTC and displayed in Africa/Lagos.
 * The display format chosen for the whole system is `DD/MM/YYYY HH:mm` on a
 * 24-hour clock. Every screen and document uses these helpers so the format
 * never drifts between modules.
 */

export const LAGOS_TIME_ZONE = 'Africa/Lagos';

type PartMap = Record<string, string>;

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: LAGOS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: LAGOS_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const TIME_WITH_SECONDS_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: LAGOS_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const MONTH_NAME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: LAGOS_TIME_ZONE,
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});

function toDate(value: Date | string | number): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Invalid date value: ${String(value)}`);
  }
  return date;
}

function parts(formatter: Intl.DateTimeFormat, value: Date): PartMap {
  const result: PartMap = {};
  for (const part of formatter.formatToParts(value)) {
    if (part.type !== 'literal') result[part.type] = part.value;
  }
  return result;
}

/** `29/09/2026` */
export function formatLagosDate(value: Date | string | number): string {
  const p = parts(DATE_FORMAT, toDate(value));
  return `${p.day}/${p.month}/${p.year}`;
}

/** `14:05` */
export function formatLagosTime(value: Date | string | number): string {
  const p = parts(TIME_FORMAT, toDate(value));
  return `${p.hour}:${p.minute}`;
}

/** `29/09/2026 14:05` - the standard timestamp shown throughout the system. */
export function formatLagosDateTime(value: Date | string | number): string {
  return `${formatLagosDate(value)} ${formatLagosTime(value)}`;
}

/** `29/09/2026 14:05:32` - used where an audit trail needs second precision. */
export function formatLagosDateTimeWithSeconds(value: Date | string | number): string {
  const date = toDate(value);
  const p = parts(TIME_WITH_SECONDS_FORMAT, date);
  return `${formatLagosDate(date)} ${p.hour}:${p.minute}:${p.second}`;
}

/** `29 September 2026` - used in memo and letter headers. */
export function formatLagosLongDate(value: Date | string | number): string {
  const p = parts(MONTH_NAME_FORMAT, toDate(value));
  return `${p.day} ${p.month} ${p.year}`;
}

/** The current instant, always in UTC. */
export function nowUtc(): Date {
  return new Date();
}

/** Canonical UTC string for storage and transport. */
export function toUtcIso(value: Date | string | number): string {
  return toDate(value).toISOString();
}

/** Whole days elapsed between two instants, used by SLA and ageing displays. */
export function daysBetween(from: Date | string | number, to: Date | string | number): number {
  const millis = toDate(to).getTime() - toDate(from).getTime();
  return Math.floor(millis / 86_400_000);
}
