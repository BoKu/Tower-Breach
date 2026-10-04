/**
 * Festive themes. A holiday is live on its day and the 3 days before it (device local date).
 * Model kinds never change: buildProp() asks currentHoliday() and dresses the same kinds differently.
 */
export type Holiday = 'xmas' | 'easter' | 'halloween';
export const HOLIDAYS: Holiday[] = ['xmas', 'easter', 'halloween'];
export const HOLIDAY_NAME: Record<Holiday, string> = { xmas: 'Christmas', easter: 'Easter', halloween: 'Halloween' };
export const HOLIDAY_LEAD_DAYS = 3;

/** Easter Sunday (Gregorian, anonymous algorithm), as a local date. */
export function easterSunday(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/** The holiday whose window (the day and the 3 days before) contains `d`, if any. */
export function holidayOn(d: Date): Holiday | null {
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  // a little slack absorbs daylight-saving shifts between the two midnights
  const inWindow = (h: Date) => { const gap = (h.getTime() - day) / 86400000; return gap > -0.1 && gap < HOLIDAY_LEAD_DAYS + 0.1; };
  const y = d.getFullYear();
  if (inWindow(new Date(y, 11, 25))) return 'xmas';
  if (inWindow(easterSunday(y))) return 'easter';
  if (inWindow(new Date(y, 9, 31))) return 'halloween';
  return null;
}

/** undefined = follow today's date; null = force no holiday; a Holiday = force it (sandboxes, dev URLs). */
let override: Holiday | null | undefined;
export function setHolidayOverride(h: Holiday | null | undefined) { override = h; }
export function currentHoliday(): Holiday | null {
  return override !== undefined ? override : holidayOn(new Date());
}
