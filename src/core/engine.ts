import ICAL from 'ical.js';
import { DateTime } from 'luxon';
import { addDays, date, isTeachingDay, monday, wallTime } from './dates';
import { baselineEvent, keyForTime, stringProp, timeToDate } from './ical';
import { exceptionId, uid } from './model';
import type { AppState, Baseline, Course, Metadata, Occurrence, SchedulePatch, Session } from './model';
import { autoGroupCourses } from './courses';

interface Candidate extends Metadata {
  key: string; originalDate: string; originalStart: string; start: string; end: string; allDay: boolean; cancelled: boolean;
}
interface ExpansionCache { event: InstanceType<typeof ICAL.Event>; checkpoints: { at: number; data: ReturnType<InstanceType<typeof ICAL.RecurExpansion>['toJSON']> }[] }
const expansionCache = new Map<string, ExpansionCache>();

function candidate(ev: InstanceType<typeof ICAL.Event>, original: InstanceType<typeof ICAL.Time>, zone: string): Candidate {
  const details = ev.getOccurrenceDetails(original);
  const start = timeToDate(details.startDate, zone);
  let end = timeToDate(details.endDate, zone);
  if (end <= start) end = start.plus(ev.startDate.isDate ? { days: 1 } : { seconds: Math.max(ev.duration.toSeconds(), 3600) });
  const item = details.item;
  return {
    key: keyForTime(ev.uid, original), originalDate: timeToDate(original, zone).toISODate()!,
    originalStart: timeToDate(original, zone).toISO()!,
    start: start.toISO()!, end: end.toISO()!, allDay: details.startDate.isDate,
    title: item.summary || ev.summary || 'Untitled event', location: item.location || ev.location || '',
    instructor: stringProp(item.component, 'x-instructor') || String(item.component.getFirstProperty('organizer')?.getParameter('cn') ?? '') || stringProp(ev.component, 'x-instructor'),
    notes: item.description || ev.description || '',
    cancelled: String(item.component.getFirstPropertyValue('status') ?? ev.component.getFirstPropertyValue('status')).toUpperCase() === 'CANCELLED',
  };
}
function expandBaseline(baseline: Baseline, start: string, end: string, zone: string, forcedKeys: string[], quickRange: { from: string; to: string }): Candidate[] {
  if (!/\r?\n(?:RRULE|RDATE|RECURRENCE-ID)[;:]/.test(baseline.ical) && !forcedKeys.some(k => k.startsWith(`${baseline.uid}|`))) {
    const startRaw = baseline.ical.match(/(?:^|\r?\n)DTSTART[^:\r\n]*:(\d{4})(\d{2})(\d{2})/);
    const endRaw = baseline.ical.match(/(?:^|\r?\n)DTEND[^:\r\n]*:(\d{4})(\d{2})(\d{2})/);
    const startDay = startRaw?.slice(1).join('-'), endDay = endRaw?.slice(1).join('-') ?? startDay;
    // Conservative date prefilter for separate VEVENT exports; eight days cover week moves and zone boundaries.
    if (startDay && endDay && (startDay > quickRange.to || endDay < quickRange.from) && !/\r?\nDURATION:/.test(baseline.ical)) return [];
  }
  const cacheKey = `${zone}\n${baseline.ical}`;
  let cache = expansionCache.get(cacheKey);
  if (!cache) {
    cache = { event: baselineEvent(baseline, zone), checkpoints: [] };
    if (expansionCache.size >= 512) expansionCache.delete(expansionCache.keys().next().value!);
    expansionCache.set(cacheKey, cache);
  }
  const ev = cache.event;
  const firstExcluded = ev.component.getAllProperties('exdate').some(p => p.getValues().some(t => t instanceof ICAL.Time && t.compare(ev.startDate) === 0));
  if (!ev.isRecurring()) return firstExcluded ? [] : [candidate(ev, ev.startDate, zone)];
  const from = date(start, zone).minus({ days: 8, seconds: Math.max(ev.duration.toSeconds(), 0) }).toMillis();
  const until = date(end, zone).plus({ days: 8 }).toMillis();
  // RANGE=THISANDFUTURE may move the whole remaining source series. Expand its original dates as well.
  let shift = 0;
  for (const ex of Object.values(ev.exceptions)) {
    if (ex.modifiesFuture()) shift = Math.max(shift, Math.abs(timeToDate(ex.startDate, zone).diff(timeToDate(ex.recurrenceId, zone), 'milliseconds').milliseconds));
  }
  const lower = from - shift, upper = until + shift;
  const checkpoint = [...cache.checkpoints].reverse().find(c => c.at < lower);
  const iter = checkpoint ? new ICAL.RecurExpansion(checkpoint.data) : ev.iterator();
  const candidates = new Map<string, Candidate>();
  // DTSTART belongs to the recurrence set even when an RDATE-only expansion omits it.
  const firstTs = timeToDate(ev.startDate, zone).toMillis();
  if (!firstExcluded && firstTs >= lower && firstTs <= upper) {
    const first = candidate(ev, ev.startDate, zone); candidates.set(first.key, first);
  }
  let count = 0, month = '';
  while (true) {
    const snapshot = iter.toJSON();
    const next = iter.next();
    if (!next) break;
    const ts = timeToDate(next, zone).toMillis();
    if (ts > upper) break;
    if (++count > 200_000) throw new Error('A recurrence exceeds the safe expansion limit. Shorten its date range.');
    const thisMonth = next.toString().slice(0, 7);
    if (!checkpoint && thisMonth !== month && ts < lower) {
      month = thisMonth;
      cache.checkpoints.push({ at: ts, data: snapshot });
      if (cache.checkpoints.length > 48) cache.checkpoints.shift();
    }
    if (ts >= lower) {
      const c = candidate(ev, next, zone); candidates.set(c.key, c);
    }
  }
  // Explicit source exceptions can jump arbitrarily far; always inspect them by their original key.
  for (const ex of Object.values(ev.exceptions)) {
    const original = ex.recurrenceId;
    const c = candidate(ev, original, zone); candidates.set(c.key, c);
  }
  // User exceptions are looked up by original identity, even when the edited date is years away.
  for (const key of forcedKeys) {
    if (!key.startsWith(`${ev.uid}|`)) continue;
    const original = ICAL.Time.fromString(key.slice(ev.uid.length + 1), undefined);
    original.zone = ev.startDate.zone;
    const c = candidate(ev, original, zone); candidates.set(c.key, c);
  }
  return [...candidates.values()];
}
export function effectivePatch(session: Session, originalDate: string): SchedulePatch {
  return Object.assign({}, ...session.overrides.filter(o => o.from <= originalDate && o.to >= originalDate).map(o => o.patch));
}
function renderCandidate(state: AppState, session: Session, course: Course, c: Candidate): Occurrence | undefined {
  const id = exceptionId(session.id, c.key), ex = state.exceptions[id];
  if (ex?.cancelled || c.cancelled) return;
  const patch = ex?.original ? {} : effectivePatch(session, c.originalDate);
  const zone = date(c.start, state.settings.timezone).zoneName!;
  let start = date(c.start, zone), end = date(c.end, zone);
  let targetDate = start.toISODate()!;
  if (patch.weekday !== undefined) targetDate = addDays(monday(date(c.originalStart, zone).toISODate()!), patch.weekday - 1);
  if (patch.weekday !== undefined || patch.startTime) {
    start = date(wallTime(targetDate, patch.startTime ?? start.toFormat('HH:mm'), zone), zone);
    end = start.plus({ milliseconds: date(c.end).toMillis() - date(c.start).toMillis() });
  }
  if (patch.endTime) {
    const endDay = patch.endTime <= start.toFormat('HH:mm') ? addDays(start.toISODate()!, 1) : start.toISODate()!;
    end = date(wallTime(endDay, patch.endTime, zone), zone);
  }
  const fields: Metadata = {
    title: course.grouped || course.name !== course.importedName ? course.name : c.title,
    location: course.location || c.location, instructor: course.instructor || c.instructor, notes: course.notes || c.notes,
  };
  for (const k of ['title', 'location', 'instructor', 'notes'] as const) {
    if (patch[k] !== undefined) fields[k] = patch[k]!;
    if (ex?.[k] !== undefined) fields[k] = ex[k]!;
  }
  if (ex?.start) start = date(ex.start, state.settings.timezone);
  if (ex?.end) end = date(ex.end, state.settings.timezone);
  return {
    ...fields, id, sessionId: session.id, courseId: course.id, originalKey: c.key, originalDate: c.originalDate,
    start: start.toISO()!, end: end.toISO()!, allDay: c.allDay,
    modified: session.overrides.some(o => o.from <= c.originalDate && o.to >= c.originalDate) || !!ex,
    baselineStart: c.start, baselineEnd: c.end,
  };
}
export function expandCalendar(state: AppState, rangeStart: string, rangeEnd: string, includeHidden = false): Occurrence[] {
  const results: Occurrence[] = [];
  const from = date(rangeStart, state.settings.timezone).toMillis(), to = date(rangeEnd, state.settings.timezone).toMillis();
  const courses = new Map(state.courses.map(c => [c.id, c]));
  const quickRange = { from: addDays(rangeStart.slice(0, 10), -8), to: addDays(rangeEnd.slice(0, 10), 8) };
  const forced = new Map<string, string[]>();
  for (const ex of Object.values(state.exceptions)) { const keys = forced.get(ex.sessionId) ?? []; keys.push(ex.originalKey); forced.set(ex.sessionId, keys); }
  for (const session of state.sessions) {
    const course = courses.get(session.courseId);
    if (!course || session.deleted || session.removed || course.deleted || (!course.visible && !includeHidden)) continue;
    const candidates = new Map<string, Candidate>();
    for (const b of session.baselines.filter(b => !b.removed)) {
      for (const c of expandBaseline(b, rangeStart, rangeEnd, state.settings.timezone, forced.get(session.id) ?? [], quickRange)) {
        if (!session.weekdays || session.weekdays.includes(date(c.originalDate).weekday)) candidates.set(c.key, c);
      }
    }
    const weeklyRanges = session.overrides.filter(o => o.patch.mode === 'weekly');
    for (const range of weeklyRanges) {
      const reference = session.baselines[0]; if (!reference) continue;
      const ev = baselineEvent(reference, state.settings.timezone), first = candidate(ev, ev.startDate, state.settings.timezone);
      const firstDate = timeToDate(ev.startDate, state.settings.timezone), originalWeekday = session.weekdays?.[0] ?? firstDate.weekday;
      const occupied = new Set([...candidates.values()].map(c => monday(c.originalDate)));
      let week = monday(rangeStart < range.from ? range.from : addDays(rangeStart, -7));
      const last = rangeEnd < range.to ? addDays(rangeEnd, 7) : range.to;
      while (week <= last) {
        const day = addDays(week, originalWeekday - 1);
        const p = effectivePatch(session, day);
        if (day >= range.from && day <= range.to && p.mode === 'weekly' && !occupied.has(week)) {
          const visibleDay = addDays(week, (p.weekday ?? originalWeekday) - 1);
          if (!p.teachingOnly || isTeachingDay(visibleDay, state)) {
            const start = wallTime(day, firstDate.toFormat('HH:mm'), firstDate.zoneName!);
            const end = date(start).plus({ milliseconds: date(first.end).toMillis() - date(first.start).toMillis() }).toISO()!;
            const c = { ...first, key: `generated|${week}`, originalDate: day, originalStart: start, start, end, cancelled: false };
            candidates.set(c.key, c); occupied.add(week);
          }
        }
        week = addDays(week, 7);
      }
    }
    // Generated occurrence exceptions outside the visible range also retain identity.
    for (const ex of Object.values(state.exceptions).filter(e => e.sessionId === session.id && e.originalKey.startsWith('generated|'))) {
      if (candidates.has(ex.originalKey) || !session.baselines.length) continue;
      if (effectivePatch(session, ex.originalDate).mode !== 'weekly') continue;
      const ev = baselineEvent(session.baselines[0], state.settings.timezone), first = candidate(ev, ev.startDate, state.settings.timezone);
      const original = timeToDate(ev.startDate, state.settings.timezone);
      const start = wallTime(ex.originalDate, original.toFormat('HH:mm'), original.zoneName!);
      candidates.set(ex.originalKey, { ...first, key: ex.originalKey, originalDate: ex.originalDate, originalStart: start, start, end: date(start).plus({ seconds: ev.duration.toSeconds() || 3600 }).toISO()!, cancelled: false });
    }
    for (const c of candidates.values()) {
      const result = renderCandidate(state, session, course, c);
      if (result && date(result.start).toMillis() < to && date(result.end).toMillis() > from) results.push(result);
    }
  }
  for (const extra of state.extras) {
    const session = state.sessions.find(s => s.id === extra.sessionId), course = session && courses.get(session.courseId);
    if (!course || course.deleted || session?.deleted || (!course.visible && !includeHidden)) continue;
    if (date(extra.start).toMillis() < to && date(extra.end).toMillis() > from) results.push({
      ...extra, id: extra.id, courseId: course.id, originalKey: extra.id, originalDate: extra.start.slice(0, 10),
      baselineStart: extra.start, baselineEnd: extra.end, modified: true, extra: true,
    });
  }
  return results.sort((a, b) => date(a.start).toMillis() - date(b.start).toMillis() || a.id.localeCompare(b.id));
}
export function updateSeries(state: AppState, sessionId: string, patch: SchedulePatch, from: string, to: string): AppState {
  if (!date(from).isValid || !date(to).isValid || from > to) throw new Error('The active range must have a valid start and end date.');
  const next = structuredClone(state), session = next.sessions.find(s => s.id === sessionId);
  if (!session) throw new Error('Session not found.');
  session.overrides.push({ id: uid(), from, to, patch });
  return next;
}
export function setException(state: AppState, occurrence: Occurrence, patch: Partial<Metadata> & { start?: string; end?: string; cancelled?: boolean; original?: boolean }): AppState {
  const next = structuredClone(state);
  next.exceptions[occurrence.id] = { ...next.exceptions[occurrence.id], sessionId: occurrence.sessionId, originalKey: occurrence.originalKey, originalDate: occurrence.originalDate, ...patch };
  return next;
}
export function restoreOccurrence(state: AppState, id: string): AppState {
  const next = structuredClone(state); delete next.exceptions[id]; return next;
}
export function restoreSession(state: AppState, sessionId: string): AppState {
  const next = structuredClone(state), session = next.sessions.find(s => s.id === sessionId);
  if (session) { session.overrides = []; session.deleted = false; }
  for (const [key, value] of Object.entries(next.exceptions)) if (value.sessionId === sessionId) delete next.exceptions[key];
  next.extras = next.extras.filter(e => e.sessionId !== sessionId);
  return next;
}
export function underlyingSessionOccurrence(state: AppState, event: Occurrence): Occurrence | undefined {
  const session = state.sessions.find(s => s.id === event.sessionId), course = state.courses.find(c => c.id === event.courseId);
  if (!session || !course) return;
  const baseline = session.baselines.find(b => event.originalKey.startsWith(`${b.uid}|`)) ?? session.baselines[0];
  if (!baseline) return;
  const source = baselineEvent(baseline, state.settings.timezone);
  const regular = new ICAL.Event(source.component, { exceptions: [] });
  const original = event.originalKey.startsWith('generated|') ? regular.startDate.clone() : ICAL.Time.fromString(event.originalKey.slice(baseline.uid.length + 1), undefined);
  original.zone = regular.startDate.zone;
  if (event.originalKey.startsWith('generated|')) { const day = date(event.originalDate); original.year = day.year; original.month = day.month; original.day = day.day; }
  const clean = { ...state, exceptions: { ...state.exceptions } }; delete clean.exceptions[event.id];
  return renderCandidate(clean, session, course, candidate(regular, original, state.settings.timezone));
}
export function sessionWeekdays(session: Session, zone: string): number[] {
  if (session.weekdays) return session.weekdays;
  const days = new Set<number>(), names: Record<string, number> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };
  for (const b of session.baselines.filter(b => !b.removed)) {
    const ev = baselineEvent(b, zone); days.add(timeToDate(ev.startDate, zone).weekday);
    for (const p of ev.component.getAllProperties('rrule')) {
      const rule = p.getFirstValue() as InstanceType<typeof ICAL.Recur>;
      if (rule.freq !== 'WEEKLY') continue;
      for (const value of rule.parts.BYDAY ?? []) { const n = names[String(value).slice(-2)]; if (n) days.add(n); }
    }
  }
  return [...days].sort();
}
export function separateWeekday(state: AppState, sessionId: string, weekday: number): AppState {
  const next = structuredClone(state), session = next.sessions.find(s => s.id === sessionId);
  if (!session) throw new Error('Session not found.');
  const days = sessionWeekdays(session, state.settings.timezone);
  if (days.length < 2 || !days.includes(weekday)) throw new Error('Choose one of the session’s multiple weekdays.');
  const separated = { ...structuredClone(session), id: uid(), weekdays: [weekday] };
  session.weekdays = days.filter(d => d !== weekday); next.sessions.push(separated);
  for (const [key, ex] of Object.entries(next.exceptions)) if (ex.sessionId === session.id && date(ex.originalDate).weekday === weekday) {
    delete next.exceptions[key]; const id = exceptionId(separated.id, ex.originalKey);
    next.exceptions[id] = { ...ex, sessionId: separated.id };
  }
  return next;
}
export function sessionRange(session: Session, zone: string): { from: string; to: string } {
  const starts: string[] = [], ends: string[] = [];
  for (const b of session.baselines) {
    const ev = baselineEvent(b, zone), start = timeToDate(ev.startDate, zone);
    starts.push(start.toISODate()!);
    for (const prop of ev.component.getAllProperties('rdate')) for (const value of prop.getValues()) {
      if (value instanceof ICAL.Time) { const day = timeToDate(value, zone).toISODate()!; starts.push(day); ends.push(day); }
    }
    const rules = ev.component.getAllProperties('rrule').map(p => p.getFirstValue() as InstanceType<typeof ICAL.Recur>);
    const rule = rules[0];
    if (rule?.until) ends.push(timeToDate(rule.until, zone).setZone(start.zoneName!).toISODate()!);
    else if (rule?.count && rule.count < 10_000) {
      const iter = ev.iterator(); let last = ev.startDate, v;
      for (let i = 0; i <= rule.count + 1 && (v = iter.next()); i++) last = v;
      ends.push(timeToDate(last, zone).toISODate()!);
    } else ends.push(rule ? start.plus({ months: 6 }).toISODate()! : start.toISODate()!);
  }
  return { from: starts.sort()[0] ?? '2026-10-01', to: ends.sort().at(-1) ?? '2027-01-15' };
}
export interface NewCourseInput extends Metadata { label: string; type: string; date: string; endDate: string; startTime: string; endTime: string; endDay?: string; color?: string; weekly: boolean; teachingOnly: boolean; courseId?: string }
export function createCourse(state: AppState, input: NewCourseInput): AppState {
  if (!input.title.trim()) throw new Error('A course name is required.');
  if (!date(input.date).isValid || input.weekly && (!date(input.endDate).isValid || input.endDate < input.date)) throw new Error('Choose a valid date range.');
  const zone = state.settings.timezone;
  const endDay = input.endDay ?? input.date;
  if (!date(endDay).isValid || date(wallTime(endDay, input.endTime, zone)).toMillis() <= date(wallTime(input.date, input.startTime, zone)).toMillis()) throw new Error('The end time must be later than the start time.');
  const next = structuredClone(state), courseId = input.courseId ?? uid(), sessionId = uid(), eventUid = uid();
  if (!input.courseId) next.courses.push({ id: courseId, name: input.title.trim(), label: input.label, type: input.type, location: input.location, instructor: input.instructor, notes: input.notes, visible: true, ...(input.color ? { color: input.color } : {}) });
  const calendar = new ICAL.Component(['vcalendar', [], []]); calendar.addPropertyWithValue('version', '2.0');
  const event = new ICAL.Event(); event.uid = eventUid; event.summary = input.title; event.location = input.location; event.description = input.notes;
  const start = ICAL.Time.fromString(`${input.date}T${input.startTime}:00`, undefined), end = ICAL.Time.fromString(`${endDay}T${input.endTime}:00`, undefined);
  event.startDate = start; event.endDate = end;
  event.component.getFirstProperty('dtstart')!.setParameter('tzid', zone);
  event.component.getFirstProperty('dtend')!.setParameter('tzid', zone);
  event.component.addPropertyWithValue('x-instructor', input.instructor);
  if (input.weekly) event.component.addPropertyWithValue('rrule', ICAL.Recur.fromString(`FREQ=WEEKLY;UNTIL=${date(wallTime(input.endDate, '23:59', zone)).toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'")}`));
  calendar.addSubcomponent(event.component);
  if (input.weekly && input.teachingOnly) {
    const excluded = new ICAL.Property('exdate'); let day = input.date; const times = [];
    while (day <= input.endDate) { if (!isTeachingDay(day, state)) times.push(ICAL.Time.fromString(`${day}T${input.startTime}:00`, undefined)); day = addDays(day, 7); }
    if (times.length) { excluded.setValues(times); excluded.setParameter('tzid', zone); event.component.addProperty(excluded); }
  }
  next.sessions.push({ id: sessionId, courseId, ...(input.courseId ? { type: input.type } : {}), baselines: [{ uid: eventUid, ical: calendar.toString() }], overrides: [] });
  return autoGroupCourses(next);
}
export function genericWeek(state: AppState, referenceDate: string): Occurrence[] {
  const from = monday(referenceDate), next = structuredClone(state);
  next.exceptions = {}; next.extras = [];
  const results: Occurrence[] = [];
  for (const session of next.sessions) {
    const course = next.courses.find(c => c.id === session.courseId);
    if (!course?.visible || course.deleted || session.deleted || session.removed || !session.baselines.length) continue;
    const b = session.baselines.find(b => !b.removed); if (!b) continue;
    const baseline = baselineEvent(b, state.settings.timezone);
    const ev = new ICAL.Event(baseline.component, { exceptions: [] });
    if (!ev.isRecurring() && session.baselines.length < 2) continue;
    const rule = ev.component.getFirstPropertyValue('rrule') as InstanceType<typeof ICAL.Recur> | null;
    if (rule && rule.freq !== 'WEEKLY') continue;
    const range = sessionRange(session, state.settings.timezone);
    const selected = referenceDate >= range.from && referenceDate <= range.to || session.overrides.some(o => o.from <= referenceDate && o.to >= referenceDate) ? referenceDate : range.from;
    const seeds = [ev.startDate], seen = new Set<string>();
    if (ev.isRecurring()) {
      const iter = ev.iterator(), limit = timeToDate(ev.startDate, state.settings.timezone).plus({ days: 14 });
      for (let i = 0; i < 30; i++) { const value = iter.next(); if (!value || timeToDate(value, state.settings.timezone) > limit) break; seeds.push(value); }
    }
    for (const seed of seeds) {
      const original = timeToDate(seed, state.settings.timezone), slot = `${original.weekday}:${original.toFormat('HH:mm')}`;
      if (session.weekdays && !session.weekdays.includes(original.weekday)) continue;
      if (seen.has(slot)) continue; seen.add(slot);
      const c = candidate(ev, seed, state.settings.timezone);
      c.originalDate = addDays(monday(selected), original.weekday - 1);
      c.start = wallTime(c.originalDate, original.toFormat('HH:mm'), original.zoneName!);
      c.originalStart = c.start;
      c.end = date(c.start).plus({ seconds: ev.duration.toSeconds() || 3600 }).toISO()!;
      c.cancelled = false;
      const result = renderCandidate(next, session, course, c); if (!result) continue;
      const s = date(result.start, state.settings.timezone), e = date(result.end, state.settings.timezone);
      const start = wallTime(addDays(from, s.weekday - 1), s.toFormat('HH:mm'), state.settings.timezone);
      results.push({ ...result, start, end: date(start).plus({ milliseconds: e.toMillis() - s.toMillis() }).toISO()! });
    }
  }
  return results;
}
