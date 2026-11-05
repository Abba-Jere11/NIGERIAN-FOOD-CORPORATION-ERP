export function startOfUtcMonth(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function startOfUtcWeek(now = new Date()): Date {
  const day = now.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + mondayOffset));
  return monday;
}

export function isOnOrAfter(iso: string | null | undefined, since: Date): boolean {
  if (!iso) return false;
  return new Date(iso).getTime() >= since.getTime();
}

export function ageBucket(days: number): '0-2' | '2-5' | '5-7' | '7+' {
  if (days >= 7) return '7+';
  if (days >= 5) return '5-7';
  if (days >= 2) return '2-5';
  return '0-2';
}

export function ageLabel(days: number): string {
  const bucket = ageBucket(days);
  if (bucket === '7+') return '7+ days';
  if (bucket === '5-7') return '5–7 days';
  if (bucket === '2-5') return '2–5 days';
  return '0–2 days';
}
