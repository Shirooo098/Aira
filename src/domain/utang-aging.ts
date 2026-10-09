export type DebtPriority = 'Current' | 'Needs attention' | 'Urgent' | 'Age unknown';
const dayMs = 86_400_000;
const manilaOffset = 8 * 60 * 60 * 1000;

/** Returns a calendar ordinal, never an elapsed-duration age. */
export function manilaDay(value: string): number | null {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const parsed = new Date(0);
    parsed.setUTCFullYear(year, month - 1, day);
    parsed.setUTCHours(0, 0, 0, 0);
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
    return Math.floor(parsed.getTime() / dayMs);
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  if (manilaDay(value.slice(0, 10)) === null) return null;
  if (Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.floor((timestamp + manilaOffset) / dayMs) : null;
}

export function calendarDate(day: number): string {
  return new Date(day * dayMs).toISOString().slice(0, 10);
}

export function debtPriority(age: number | null): DebtPriority {
  return age === null ? 'Age unknown' : age >= 7 ? 'Urgent' : age >= 3 ? 'Needs attention' : 'Current';
}

export function addCentavos(a: number, b: number): number {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 0 || b < 0 || !Number.isSafeInteger(a + b)) {
    throw new Error('Hindi ligtas ang halaga ng utang.');
  }
  return a + b;
}

export function millisecondsToManilaMidnight(now: number): number {
  return dayMs - ((now + manilaOffset) % dayMs);
}
