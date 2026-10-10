import { date } from './dates';
import { baselineEvent, timeToDate } from './ical';
import type { AppState } from './model';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(`Invalid configuration: ${message}`); }
function object(value: unknown): asserts value is Record<string, unknown> { assert(value && typeof value === 'object' && !Array.isArray(value), 'expected an object.'); }
function str(value: unknown, name: string, max = 100_000): asserts value is string { assert(typeof value === 'string' && value.length <= max, `${name} must be text (maximum ${max} characters).`); }
function boolean(value: unknown, name: string) { assert(typeof value === 'boolean', `${name} must be true or false.`); }
function day(value: unknown, name: string) { str(value, name, 10); assert(/^\d{4}-\d{2}-\d{2}$/.test(value) && date(value).isValid, `${name} is not a valid date.`); }
function datetime(value: unknown, name: string) { str(value, name, 50); assert(date(value).isValid && value.includes('T'), `${name} is not a valid timestamp.`); }
function time(value: unknown, name: string, allow24 = false) { str(value, name, 5); assert(/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) || allow24 && value === '24:00', `${name} is not a valid time.`); }
function list(value: unknown, name: string, max = 50_000): asserts value is Record<string, unknown>[] { assert(Array.isArray(value) && value.length <= max, `${name} must be an array with at most ${max} entries.`); for (const item of value) object(item); }
function ids(items: Record<string, unknown>[], name: string) { const seen = new Set(); for (const item of items) { str(item.id, `${name} ID`, 200); assert(item.id.length > 0 && !seen.has(item.id), `${name} has an empty or duplicated ID.`); seen.add(item.id); } return seen; }
function optionalText(record: Record<string, unknown>, keys: string[]) { for (const k of keys) if (record[k] !== undefined) str(record[k], k); }
function forbidPrototypeKeys(value: unknown, depth = 0) {
  assert(depth < 25, 'data is nested too deeply.');
  if (!value || typeof value !== 'object') return;
  for (const [key, v] of Object.entries(value)) { assert(!['__proto__', 'prototype', 'constructor'].includes(key), 'unsafe object property.'); forbidPrototypeKeys(v, depth + 1); }
}
const checkedBaselines = new Set<string>();
export function validateConfig(value: unknown): AppState {
  object(value); forbidPrototypeKeys(value);
  assert(value.schemaVersion === 1, 'this schema version is unsupported. Use a version 1 caLEANdar export.');
  for (const k of ['sources', 'courses', 'sessions', 'extras', 'academics']) list(value[k], k);
  const sources = value.sources as Record<string, unknown>[], courses = value.courses as Record<string, unknown>[], sessions = value.sessions as Record<string, unknown>[], extras = value.extras as Record<string, unknown>[], academics = value.academics as Record<string, unknown>[];
  const sourceIds = ids(sources, 'Source'), courseIds = ids(courses, 'Course'), sessionIds = ids(sessions, 'Session'); ids(extras, 'Extra'); const academicIds = ids(academics, 'Academic year');
  for (const s of sources) { str(s.name, 'source name'); str(s.content, 'source content', 20_000_000); datetime(s.importedAt, 'import date'); }
  for (const c of courses) { for (const key of ['name', 'label', 'type', 'location', 'instructor', 'notes']) str(c[key], key); boolean(c.visible, 'course visibility'); optionalText(c, ['importedName']); if (c.deleted !== undefined) boolean(c.deleted, 'course deletion'); if (c.grouped !== undefined) boolean(c.grouped, 'course grouping'); if (c.color !== undefined) assert(typeof c.color === 'string' && /^#[\da-f]{6}$/i.test(c.color), 'course color must be a six-digit hex color.'); }
  for (const s of sessions) {
    assert(courseIds.has(s.courseId), 'a session references a missing course.'); assert(s.sourceId === undefined || sourceIds.has(s.sourceId), 'a session references a missing source.');
    list(s.baselines, 'baselines'); list(s.overrides, 'session overrides');
    const uids = new Set();
    for (const b of s.baselines) {
      str(b.uid, 'UID', 2000); str(b.ical, 'baseline content', 20_000_000); assert(b.uid.length && !uids.has(b.uid), 'empty or duplicate UID within a session.'); uids.add(b.uid);
      if (b.removed !== undefined) boolean(b.removed, 'baseline removal');
      const checkKey = `${b.uid}\n${b.ical}`;
      if (!checkedBaselines.has(checkKey)) {
        const ev = baselineEvent(b as unknown as AppState['sessions'][number]['baselines'][number]);
        assert(ev.uid === b.uid && !!ev.startDate && timeToDate(ev.startDate, 'Europe/Ljubljana').isValid && timeToDate(ev.endDate, 'Europe/Ljubljana').isValid && ev.endDate.compare(ev.startDate) >= 0, 'invalid baseline identity or dates.');
        assert(!ev.component.hasProperty('exrule') && !ev.component.getAllProperties('rdate').some(p => p.type === 'period'), 'unsupported recurrence exclusions or period values.');
        for (const p of ev.component.getAllProperties('rrule')) { const r = p.getFirstValue() as { freq: string; interval: number; count: number | null }; assert(!['SECONDLY', 'MINUTELY', 'HOURLY'].includes(r.freq) && r.interval > 0 && (r.count === null || r.count > 0), 'unsupported or invalid recurrence.'); }
        for (const ex of Object.values(ev.exceptions)) assert(timeToDate(ex.recurrenceId, 'Europe/Ljubljana').isValid && timeToDate(ex.startDate, 'Europe/Ljubljana').isValid, 'invalid source exception dates.');
        if (checkedBaselines.size > 20_000) checkedBaselines.clear(); checkedBaselines.add(checkKey);
      }
    }
    for (const o of s.overrides) {
      str(o.id, 'override ID', 200); day(o.from, 'override start'); day(o.to, 'override end'); assert(String(o.from) <= String(o.to), 'override range is reversed.'); object(o.patch);
      optionalText(o.patch, ['title', 'location', 'instructor', 'notes']);
      if (o.patch.weekday !== undefined) assert(Number.isInteger(o.patch.weekday) && Number(o.patch.weekday) >= 1 && Number(o.patch.weekday) <= 7, 'invalid weekday.');
      if (o.patch.startTime !== undefined) time(o.patch.startTime, 'session start time'); if (o.patch.endTime !== undefined) time(o.patch.endTime, 'session end time');
      assert(o.patch.mode === undefined || ['preserve', 'weekly'].includes(String(o.patch.mode)), 'invalid repeating mode.'); if (o.patch.teachingOnly !== undefined) boolean(o.patch.teachingOnly, 'teaching constraint');
    }
    if (s.deleted !== undefined) boolean(s.deleted, 'session deletion'); if (s.removed !== undefined) boolean(s.removed, 'source removal');
    if (s.type !== undefined) str(s.type, 'session type', 100);
    if (s.weekdays !== undefined) assert(Array.isArray(s.weekdays) && s.weekdays.length > 0 && s.weekdays.every(v => Number.isInteger(v) && v >= 1 && v <= 7) && new Set(s.weekdays).size === s.weekdays.length, 'invalid weekday session filter.');
  }
  object(value.exceptions);
  assert(Object.keys(value.exceptions).length <= 50_000, 'too many exceptions.');
  const sessionMap = new Map(sessions.map(s => [s.id, s]));
  for (const [key, ex] of Object.entries(value.exceptions)) {
    object(ex); assert(sessionIds.has(ex.sessionId), 'an exception references a missing session.'); str(ex.originalKey, 'occurrence identity', 2200); day(ex.originalDate, 'original date');
    assert(key === `${ex.sessionId}::${ex.originalKey}`, 'occurrence identity does not match its key.'); optionalText(ex, ['title', 'location', 'instructor', 'notes']);
    if (ex.originalKey.startsWith('generated|')) day(ex.originalKey.slice(10), 'generated occurrence week');
    else {
      const session = sessionMap.get(ex.sessionId)!;
      const originalKey = ex.originalKey;
      const baseline = (session.baselines as Record<string, unknown>[]).find(b => originalKey.startsWith(`${b.uid}|`));
      assert(baseline, 'an exception has no matching source UID.');
      const stamp = ex.originalKey.slice(String(baseline.uid).length + 1);
      assert(/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}Z?)?$/.test(stamp) && date(stamp).isValid, 'invalid original occurrence timestamp.');
    }
    if (ex.start !== undefined) datetime(ex.start, 'occurrence start'); if (ex.end !== undefined) datetime(ex.end, 'occurrence end');
    if (ex.start && ex.end) assert(date(String(ex.end)).toMillis() > date(String(ex.start)).toMillis(), 'occurrence end precedes its start.');
    if (ex.cancelled !== undefined) boolean(ex.cancelled, 'cancellation'); if (ex.original !== undefined) boolean(ex.original, 'original schedule');
  }
  for (const ex of extras) { assert(sessionIds.has(ex.sessionId), 'an extra references a missing session.'); for (const k of ['title', 'location', 'instructor', 'notes']) str(ex[k], k); datetime(ex.start, 'extra start'); datetime(ex.end, 'extra end'); assert(date(String(ex.end)).toMillis() > date(String(ex.start)).toMillis(), 'extra end precedes its start.'); boolean(ex.allDay, 'all-day value'); }
  for (const y of academics) {
    str(y.name, 'academic year name'); list(y.periods, 'academic periods', 100); list(y.breaks, 'breaks', 1000); ids(y.periods, 'Academic period'); ids(y.breaks, 'Break');
    for (const p of [...y.periods, ...y.breaks]) { str(p.name, 'period name'); day(p.start, 'period start'); day(p.end, 'period end'); assert(String(p.start) <= String(p.end), 'academic range is reversed.'); }
    for (const p of y.periods) assert(['teaching', 'exam'].includes(String(p.kind)), 'invalid academic period kind.');
  }
  object(value.settings); const s = value.settings;
  assert(typeof s.accent === 'string' && /^#[\da-f]{6}$/i.test(s.accent), 'accent must be a six-digit hex color.');
  assert(['light', 'dark'].includes(String(s.theme)) && ['mono', 'system'].includes(String(s.font)), 'invalid appearance.');
  assert(['comfortable', 'compact'].includes(String(s.density)), 'invalid density.');
  for (const k of ['fontSize', 'eventFontSize']) assert(typeof s[k] === 'number' && Number(s[k]) >= 10 && Number(s[k]) <= 24, `invalid ${k}.`);
  str(s.timezone, 'timezone', 200); assert(date('2026-01-01', s.timezone).isValid, 'unknown display timezone.');
  assert(['timeGridWeek', 'dayGridMonth', 'timeGridDay'].includes(String(s.view)), 'invalid calendar view.');
  time(s.minTime, 'visible start'); time(s.maxTime, 'visible end', true); assert(String(s.minTime) < String(s.maxTime), 'visible hours must be in ascending order.');
  assert(Number.isInteger(s.firstDay) && Number(s.firstDay) >= 0 && Number(s.firstDay) <= 6, 'invalid first weekday.');
  for (const k of ['weekends', 'hour12', 'weekNumbers', 'academicOverlay', 'publicHolidays']) boolean(s[k], k);
  assert(academicIds.has(s.academicYearId), 'selected academic year is missing.');
  assert(Array.isArray(s.types) && s.types.length <= 100 && s.types.every(t => typeof t === 'string' && t.length < 100 && t.length > 0), 'invalid course types.');
  object(s.labels); for (const k of ['short', 'location', 'type', 'instructor', 'time']) boolean(s.labels[k], `label ${k}`); str(s.labels.custom, 'custom label', 200);
  return structuredClone(value) as unknown as AppState;
}
export function parseConfig(content: string): AppState {
  if (content.length > 40_000_000) throw new Error('Configuration files must be smaller than 40 MB.');
  let value; try { value = JSON.parse(content.replace(/^\uFEFF/, '')); } catch { throw new Error('This file is not valid JSON. The current calendar has not changed.'); }
  return validateConfig(value);
}
export const serializeConfig = (state: AppState) => JSON.stringify(validateConfig(state), null, 2);
export function configurationConflicts(current: AppState, incoming: AppState): string[] {
  const conflicts: string[] = [];
  for (const key of ['sources', 'courses', 'sessions', 'extras', 'academics'] as const) {
    const map = new Map(current[key].map(item => [item.id, JSON.stringify(item)]));
    for (const item of incoming[key]) if (map.has(item.id) && map.get(item.id) !== JSON.stringify(item)) conflicts.push(`${key}: ${'name' in item ? item.name : item.id}`);
  }
  for (const [key, ex] of Object.entries(incoming.exceptions)) if (current.exceptions[key] && JSON.stringify(current.exceptions[key]) !== JSON.stringify(ex)) conflicts.push(`Occurrence: ${ex.originalDate}`);
  if (JSON.stringify(current.settings) !== JSON.stringify(incoming.settings)) conflicts.push('Preferences');
  return conflicts;
}
export function mergeConfig(current: AppState, incoming: AppState, resolution: 'current' | 'incoming'): AppState {
  const result = structuredClone(current);
  for (const key of ['sources', 'courses', 'sessions', 'extras', 'academics'] as const) {
    const map = new Map<string, unknown>(current[key].map(item => [item.id, item]));
    for (const item of incoming[key]) if (!map.has(item.id) || resolution === 'incoming') map.set(item.id, item);
    (result[key] as unknown[]) = [...map.values()];
  }
  result.exceptions = resolution === 'incoming' ? { ...current.exceptions, ...incoming.exceptions } : { ...incoming.exceptions, ...current.exceptions };
  result.settings = resolution === 'incoming' ? incoming.settings : current.settings;
  return validateConfig(result);
}
