import ICAL from 'ical.js';
import { DateTime } from 'luxon';
import type { Baseline } from './model';

function ianaZone(tzid: string): InstanceType<typeof ICAL.Timezone> {
  const existing = ICAL.TimezoneService.get(tzid); if (existing) return existing;
  if (!DateTime.now().setZone(tzid).isValid) throw new Error(`Unknown timezone “${tzid}”. Include its VTIMEZONE definition in the file.`);
  const zone = new ICAL.Timezone({ tzid });
  zone.utcOffset = time => DateTime.fromObject({ year: time.year, month: time.month, day: time.day, hour: time.hour, minute: time.minute, second: time.second }, { zone: tzid }).offset * 60;
  ICAL.TimezoneService.register(zone, tzid); return zone;
}
export function prepareCalendar(content: string, fallback = 'Europe/Ljubljana'): InstanceType<typeof ICAL.Component> {
  const component = new ICAL.Component(ICAL.parse(content.replace(/^\uFEFF/, '')));
  if (component.name !== 'vcalendar') throw new Error('Expected a VCALENDAR document.');
  // ical.js uses embedded VTIMEZONEs. For IANA TZIDs without one, delegate offsets to Intl via Luxon.
  for (const event of component.getAllSubcomponents('vevent')) {
    for (const prop of event.getAllProperties()) {
      const tzid = prop.getParameter('tzid');
      if (typeof tzid === 'string' && !component.getTimeZoneByID(tzid)) ianaZone(tzid);
      // Set the hydrated Time's zone, leaving the original jCal and iCalendar text unchanged.
      for (const v of prop.getValues()) {
        if (v instanceof ICAL.Time && !v.isDate && v.zone === ICAL.Timezone.localTimezone) v.zone = ianaZone(fallback);
        if (v instanceof ICAL.Recur && v.until && !v.until.isDate && v.until.zone === ICAL.Timezone.localTimezone) v.until.zone = ianaZone(fallback);
      }
    }
  }
  return component;
}
export function timeToDate(time: InstanceType<typeof ICAL.Time>, fallback: string): DateTime {
  if (time.isDate) return DateTime.fromObject({ year: time.year, month: time.month, day: time.day }, { zone: fallback });
  const zone = time.zone?.tzid;
  if (zone && zone !== 'floating' && zone !== 'local' && zone !== 'UTC' && zone !== 'Z' && !DateTime.now().setZone(zone).isValid) {
    return DateTime.fromSeconds(time.toUnixTime(), { zone: fallback });
  }
  const useZone = zone === 'UTC' || zone === 'Z' ? 'UTC' : zone && zone !== 'floating' && zone !== 'local' ? zone : fallback;
  return DateTime.fromObject({ year: time.year, month: time.month, day: time.day, hour: time.hour, minute: time.minute, second: time.second }, { zone: useZone });
}
export function baselineEvent(baseline: Baseline, fallback = 'Europe/Ljubljana'): InstanceType<typeof ICAL.Event> {
  const calendar = prepareCalendar(baseline.ical, fallback);
  const events = calendar.getAllSubcomponents('vevent');
  const main = events.find(c => !c.hasProperty('recurrence-id')) ?? events[0];
  return new ICAL.Event(main, { exceptions: events.filter(c => c !== main) });
}
export const keyForTime = (uid: string, time: InstanceType<typeof ICAL.Time>) => `${uid}|${time.toString()}`;
export const stringProp = (component: InstanceType<typeof ICAL.Component>, name: string) => String(component.getFirstPropertyValue(name) ?? '');
