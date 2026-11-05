/**
 * Canonical JSON (RFC 8785 / JCS subset).
 *
 * Object keys are sorted. No insignificant whitespace. Hashing is done by the
 * caller (Node `crypto`) so this module stays usable from the web bundle.
 */

export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Canonical JSON cannot represent non-finite numbers.');
    }
    if (Object.is(value, -0)) return '0';
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const parts = keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`);
    return `{${parts.join(',')}}`;
  }
  throw new TypeError(`Canonical JSON cannot represent ${typeof value}.`);
}
