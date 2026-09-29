/**
 * Field-level diffing for audit entries.
 *
 * Rule R1 requires every mutation to record what changed. The audit log stores
 * `old_value` and `new_value` as JSON containing only the fields that actually
 * moved, so a reviewer reading the log sees the change rather than the whole row.
 */

export type JsonRecord = Record<string, unknown>;

export interface FieldDiff {
  /** Previous values of changed fields. Null when the record was created. */
  oldValue: JsonRecord | null;
  /** New values of changed fields. Null when the record was removed from use. */
  newValue: JsonRecord | null;
  changedFields: string[];
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as JsonRecord)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  return value;
}

export function valuesEqual(a: unknown, b: unknown): boolean {
  return stableStringify(normalize(a)) === stableStringify(normalize(b));
}

/**
 * Compares two versions of a record. Only keys present in `after` are
 * considered, so passing a partial update yields a diff of just that update.
 */
export function computeDiff(before: JsonRecord | null, after: JsonRecord | null): FieldDiff {
  if (before === null && after === null) {
    return { oldValue: null, newValue: null, changedFields: [] };
  }
  if (before === null) {
    const newValue: JsonRecord = {};
    for (const [key, value] of Object.entries(after ?? {})) {
      if (value !== undefined) newValue[key] = normalize(value);
    }
    return { oldValue: null, newValue, changedFields: Object.keys(newValue) };
  }
  if (after === null) {
    const oldValue: JsonRecord = {};
    for (const [key, value] of Object.entries(before)) {
      if (value !== undefined) oldValue[key] = normalize(value);
    }
    return { oldValue, newValue: null, changedFields: Object.keys(oldValue) };
  }

  const oldValue: JsonRecord = {};
  const newValue: JsonRecord = {};
  const changedFields: string[] = [];

  for (const [key, rawNext] of Object.entries(after)) {
    if (rawNext === undefined) continue;
    const next = normalize(rawNext);
    const previous = normalize(before[key]);
    if (!valuesEqual(previous, next)) {
      oldValue[key] = previous ?? null;
      newValue[key] = next;
      changedFields.push(key);
    }
  }

  return {
    oldValue: changedFields.length > 0 ? oldValue : null,
    newValue: changedFields.length > 0 ? newValue : null,
    changedFields,
  };
}
