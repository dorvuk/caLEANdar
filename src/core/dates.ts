import { DateTime } from 'luxon';
import type { AcademicYear, AppState } from './model';

export const date = (value: string, zone = 'Europe/Ljubljana') => DateTime.fromISO(value, { zone });
export const monday = (value: string) => date(value).startOf('week').toISODate()!;
export const addDays = (value: string, days: number) => date(value).plus({ days }).toISODate()!;
export const today = (zone: string) => DateTime.now().setZone(zone).toISODate()!;
export const localInput = (value: string, zone: string) => date(value, zone).toFormat("yyyy-MM-dd'T'HH:mm");
export function wallTime(day: string, time: string, zone: string): string {
  const value = DateTime.fromISO(`${day}T${time}`, { zone });
  if (!value.isValid || value.toFormat('HH:mm') !== time) throw new Error('This local time does not exist because of a daylight-saving transition. Choose another time.');
  return value.toISO()!;
}
export function academicInfo(day: string, year?: AcademicYear) {
  const pause = year?.breaks.find(b => b.start <= day && b.end >= day);
  const period = year?.periods.find(p => p.start <= day && p.end >= day);
  const week = period?.kind === 'teaching' ? Math.floor(date(monday(day)).diff(date(monday(period.start)), 'days').days / 7) + 1 : undefined;
  return { period, week, pause };
}
export function isTeachingDay(day: string, state: AppState): boolean {
  const info = academicInfo(day, state.academics.find(y => y.id === state.settings.academicYearId));
  return info.period?.kind === 'teaching' && !info.pause;
}
export function slovenianHoliday(day: string): string | undefined {
  const fixed: Record<string, string> = {
    '01-01': 'New Year', '01-02': 'New Year', '02-08': 'Prešeren Day', '04-27': 'Resistance Day',
    '05-01': 'Labour Day', '05-02': 'Labour Day', '06-25': 'Statehood Day', '08-15': 'Assumption',
    '10-31': 'Reformation Day', '11-01': 'All Saints', '12-25': 'Christmas', '12-26': 'Independence and Unity Day',
  };
  if (fixed[day.slice(5)]) return fixed[day.slice(5)];
  const year = Number(day.slice(0, 4));
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  const easter = DateTime.fromObject({ year, month: Math.floor(n / 31), day: n % 31 + 1 });
  if (day === easter.toISODate()) return 'Easter Sunday';
  if (day === easter.plus({ days: 1 }).toISODate()) return 'Easter Monday';
  if (day === easter.plus({ days: 49 }).toISODate()) return 'Whit Sunday';
}
