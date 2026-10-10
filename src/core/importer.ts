import ICAL from 'ical.js';
import type { AppState, Baseline, Session } from './model';
import { uid } from './model';
import { baselineEvent, prepareCalendar, stringProp, timeToDate } from './ical';

export interface ImportGroup { name: string; baselines: Baseline[]; existingSessionId?: string }
export interface ImportPreview {
  sourceId: string; sourceName: string; content: string; groups: ImportGroup[];
  warnings: string[]; added: number; changed: number; unchanged: number; removed: string[];
  differences: { title: string; before: string; after: string }[];
}
export function previewImport(state: AppState, content: string, name: string, sourceId?: string): ImportPreview {
  if (content.length > 20_000_000) throw new Error('Calendar files must be smaller than 20 MB.');
  const calendar = prepareCalendar(content, state.settings.timezone);
  const components = calendar.getAllSubcomponents('vevent');
  if (!components.length) throw new Error('No VEVENT records were found. Your existing calendar has not changed.');
  if (components.length > 50_000) throw new Error('This file exceeds the 50,000 event limit. Export a smaller timetable.');
  const warnings: string[] = [], byUid = new Map<string, Map<string, InstanceType<typeof ICAL.Component>>>();
  for (const c of components) {
    let id = stringProp(c, 'uid');
    if (!id) {
      // Content-based identity is stable on repeated import; warn that changed events cannot be matched.
      id = `missing-${fingerprint(c.toString())}`; c.updatePropertyWithValue('uid', id);
      warnings.push('An event has no UID. Content identity is used; an updated version may need manual regrouping.');
    }
    const key = String(c.getFirstPropertyValue('recurrence-id') ?? 'master');
    const versions = byUid.get(id) ?? new Map();
    const prev = versions.get(key);
    if (!prev || Number(c.getFirstPropertyValue('sequence') ?? 0) >= Number(prev.getFirstPropertyValue('sequence') ?? 0)) versions.set(key, c);
    byUid.set(id, versions);
  }
  const baselines: Baseline[] = [];
  for (const [id, versions] of byUid) {
    const main = versions.get('master');
    if (!main) { warnings.push(`“${id}” contains an orphan RECURRENCE-ID and cannot be imported. Include the series master.`); continue; }
    try {
      if (!main.hasProperty('dtstart')) throw new Error('DTSTART is missing');
      const ev = new ICAL.Event(main);
      if (!timeToDate(ev.startDate, state.settings.timezone).isValid || ev.endDate.compare(ev.startDate) < 0) throw new Error('invalid date range');
      for (const rule of main.getAllProperties('rrule')) {
        const recur = rule.getFirstValue() as InstanceType<typeof ICAL.Recur>;
        if (['SECONDLY', 'MINUTELY', 'HOURLY'].includes(recur.freq)) throw new Error('sub-daily recurrences are not supported for university timetables');
        if (recur.interval < 1 || (recur.count !== null && recur.count <= 0)) throw new Error('invalid recurrence interval or count');
      }
      if (main.hasProperty('exrule')) throw new Error('EXRULE is unsupported; export EXDATE exclusions instead');
      if (main.getAllProperties('rdate').some(p => p.type === 'period')) throw new Error('RDATE periods with distinct durations are unsupported; use RECURRENCE-ID exceptions');
      const wrapper = new ICAL.Component(['vcalendar', [], []]);
      wrapper.addPropertyWithValue('version', '2.0');
      for (const tz of calendar.getAllSubcomponents('vtimezone')) wrapper.addSubcomponent(new ICAL.Component(tz.toJSON()));
      for (const c of versions.values()) {
        if (!c.hasProperty('dtstart') && c !== main) {
          const rec = c.getFirstPropertyValue('recurrence-id');
          if (String(c.getFirstPropertyValue('status')).toUpperCase() === 'CANCELLED' && rec) c.addPropertyWithValue('dtstart', rec);
          else throw new Error('exception is missing DTSTART');
        }
        wrapper.addSubcomponent(new ICAL.Component(c.toJSON()));
      }
      const baseline = { uid: id, ical: wrapper.toString() };
      const test = baselineEvent(baseline, state.settings.timezone);
      test.iterator().next();
      baselines.push(baseline);
    } catch (e) { warnings.push(`Skipped “${evName(main)}”: ${e instanceof Error ? e.message : String(e)}.`); }
  }
  if (!baselines.length) throw new Error(warnings.join('\n') || 'No valid events found.');
  let existingSource = sourceId ? state.sources.find(s => s.id === sourceId) : state.sources.find(s => s.content === content || s.name === name);
  if (!sourceId && !existingSource) {
    const incoming = new Set(baselines.map(b => b.uid));
    const matches = state.sources.map(source => ({ source, count: state.sessions.filter(s => s.sourceId === source.id).flatMap(s => s.baselines).filter(b => incoming.has(b.uid)).length })).filter(m => m.count > 0).sort((a, b) => b.count - a.count);
    if (matches.length && (matches.length === 1 || matches[0].count > matches[1].count)) existingSource = matches[0].source;
  }
  const sid = existingSource?.id ?? uid();
  const old = state.sessions.filter(s => s.sourceId === sid);
  const uidSession = new Map(old.flatMap(s => s.baselines.map(b => [b.uid, s] as const)));
  const signatureOf = (ev: InstanceType<typeof ICAL.Event>, weekday?: number) => {
    const start = timeToDate(ev.startDate, state.settings.timezone);
    return [ev.summary || 'Untitled event', ev.location, ev.description, ev.organizer, stringProp(ev.component, 'x-instructor'), stringProp(ev.component, 'categories'), start.zoneName, weekday ?? start.weekday, start.toFormat('HH:mm:ss'), ev.duration.toSeconds(), ev.startDate.isDate].join('\u001f');
  };
  const signatureSessions = new Map<string, Set<Session>>(), occupiedWeeks = new Map<string, Set<string>>();
  const addSignature = (ev: InstanceType<typeof ICAL.Event>, s: Session) => {
    for (const day of s.weekdays ?? [timeToDate(ev.startDate, state.settings.timezone).weekday]) {
      const sig = signatureOf(ev, day), matches = signatureSessions.get(sig) ?? new Set(); matches.add(s); signatureSessions.set(sig, matches);
    }
  };
  for (const s of old) for (const b of s.baselines) addSignature(baselineEvent(b, state.settings.timezone), s);
  for (const b of baselines) {
    const ev = baselineEvent(b, state.settings.timezone), start = timeToDate(ev.startDate, state.settings.timezone);
    for (const s of old.filter(s => s.baselines.some(v => v.uid === b.uid))) {
      addSignature(ev, s);
      if (!ev.isRecurring()) { const weeks = occupiedWeeks.get(s.id) ?? new Set(); weeks.add(start.startOf('week').toISODate()!); occupiedWeeks.set(s.id, weeks); }
    }
  }
  const groups = new Map<string, ImportGroup>();
  const seenWeeks = new Map<string, Set<string>>();
  let added = 0, changed = 0, unchanged = 0;
  const differences: ImportPreview['differences'] = [];
  for (const baseline of baselines) {
    const ev = baselineEvent(baseline, state.settings.timezone);
    let existing = uidSession.get(baseline.uid);
    const start = timeToDate(ev.startDate, state.settings.timezone);
    const title = ev.summary || 'Untitled event';
    const signature = signatureOf(ev), week = start.startOf('week').toISODate()!;
    if (!existing && !ev.isRecurring()) {
      const matches = [...(signatureSessions.get(signature) ?? [])].filter(s => !occupiedWeeks.get(s.id)?.has(week));
      if (matches.length === 1) { existing = matches[0]; const weeks = occupiedWeeks.get(existing.id) ?? new Set(); weeks.add(week); occupiedWeeks.set(existing.id, weeks); }
    }
    // Conservative grouping: exact metadata and weekly slot, distinct ISO weeks. Recurring UIDs stay independent.
    let groupKey = existing ? `existing:${existing.id}` : ev.isRecurring() ? `uid:${baseline.uid}` : `slot:${signature}`;
    const weeks = seenWeeks.get(groupKey) ?? new Set();
    if (!existing && weeks.has(week)) groupKey = `uid:${baseline.uid}`;
    weeks.add(week); seenWeeks.set(groupKey, weeks);
    const group = groups.get(groupKey) ?? { name: title, baselines: [], existingSessionId: existing?.id };
    group.baselines.push(baseline); groups.set(groupKey, group);
    const prev = existing?.baselines.find(b => b.uid === baseline.uid);
    if (!prev) added++; else if (prev.ical === baseline.ical) unchanged++; else {
      changed++;
      const previous = baselineEvent(prev, state.settings.timezone);
      const describe = (item: InstanceType<typeof ICAL.Event>) => `${timeToDate(item.startDate, state.settings.timezone).toFormat('ccc, d MMM yyyy · HH:mm')}–${timeToDate(item.endDate, state.settings.timezone).toFormat('HH:mm')} · ${item.location || 'No location'} · ${item.isRecurring() ? String(item.component.getFirstPropertyValue('rrule') ?? 'RDATE recurrence') : 'Single event'}`;
      const before = describe(previous), after = describe(ev);
      differences.push({ title, before, after: before === after ? `${after} · source metadata or exceptions changed` : after });
    }
  }
  const incomingUids = new Set(baselines.map(b => b.uid));
  // Skipped records are kept on reimport: a partially unsupported file must not destroy the old baseline.
  const skippedUids = new Set(byUid.keys());
  const removed = old.flatMap(s => s.baselines.filter(b => !incomingUids.has(b.uid) && !skippedUids.has(b.uid)).map(b => b.uid));
  if (existingSource && old.length && ![...incomingUids].some(id => uidSession.has(id))) warnings.push('No UIDs match this source. If the university regenerated identifiers, local overrides cannot be matched automatically.');
  return { sourceId: sid, sourceName: name, content, groups: [...groups.values()], warnings: [...new Set(warnings)], added, changed, unchanged, removed, differences };
}
const evName = (c: InstanceType<typeof ICAL.Component>) => stringProp(c, 'summary') || stringProp(c, 'uid');
function fingerprint(value: string): string {
  let a = 2166136261, b = 5381;
  for (let i = 0; i < value.length; i++) { a = Math.imul(a ^ value.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ value.charCodeAt(i); }
  return `${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`;
}
export function applyImport(state: AppState, preview: ImportPreview): AppState {
  const next = structuredClone(state);
  const source = { id: preview.sourceId, name: preview.sourceName, content: preview.content, importedAt: new Date().toISOString() };
  next.sources = [...next.sources.filter(s => s.id !== source.id), source];
  const incoming = new Map(preview.groups.flatMap(g => g.baselines.map(b => [b.uid, b] as const)));
  for (const session of next.sessions.filter(s => s.sourceId === source.id)) {
    session.baselines = session.baselines.map(b => incoming.has(b.uid) ? structuredClone(incoming.get(b.uid)!) : preview.removed.includes(b.uid) ? { ...b, removed: true } : b);
    session.removed = session.baselines.every(b => b.removed);
  }
  for (const group of preview.groups) {
    const existing = next.sessions.find(s => s.id === group.existingSessionId);
    if (existing) {
      const known = new Set(existing.baselines.map(b => b.uid));
      existing.baselines.push(...group.baselines.filter(b => !known.has(b.uid))); existing.removed = false;
      const course = next.courses.find(c => c.id === existing.courseId)!;
      if (!course.grouped) {
        if (course.name === course.importedName) course.name = group.name;
        course.importedName = group.name;
      }
    } else {
      const courseId = uid();
      next.courses.push({ id: courseId, name: group.name, importedName: group.name, label: '', type: inferType(group.name), location: '', instructor: '', notes: '', visible: true });
      const session: Session = { id: uid(), courseId, sourceId: source.id, baselines: group.baselines, overrides: [] };
      next.sessions.push(session);
    }
  }
  return next;
}
function inferType(name: string) {
  if (/lab|laborator|\bLV\b/i.test(name)) return 'Laboratory';
  if (/tutorial|vaje|\bAV\b/i.test(name)) return 'Tutorial';
  if (/exam|izpit/i.test(name)) return 'Exam';
  return 'Lecture';
}
