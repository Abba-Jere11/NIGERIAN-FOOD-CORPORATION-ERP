/** Minimal class-name joiner. Keeps a dependency out of the bundle. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(' ');
}
