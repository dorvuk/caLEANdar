import { describe, expect, it } from 'vitest';
import { date, academicInfo } from '../src/core/dates';
import { applyImport, previewImport } from '../src/core/importer';
import { createCourse, expandCalendar, genericWeek, restoreOccurrence, restoreSession, separateWeekday, sessionRange, setException, underlyingSessionOccurrence, updateSeries } from '../src/core/engine';
import { emptyState, type AppState } from '../src/core/model';
import { configurationConflicts, mergeConfig, parseConfig, serializeConfig } from '../src/core/config';
import { event, individual, recurring, wrap } from './fixtures';

const imported = (ics = recurring) => applyImport(emptyState(), previewImport(emptyState(), ics, 'test.ics'));
const expand = (state: AppState) => expandCalendar(state, '2026-09-28', '2026-12-01');
const local = (iso: string) => date(iso).toFormat('yyyy-MM-dd HH:mm');
const moved = (state = imported()) => updateSeries(state, state.sessions[0].id, { weekday: 1, startTime: '10:00', endTime: '12:00' }, '2026-10-02', '2026-11-20');

describe.each([['RRULE', recurring], ['individual VEVENTs', individual]])('required workflows with %s', (_, fixture) => {
  it('moves every Friday to Monday of the same ISO week, without duplicates', () => {
    const state = moved(imported(fixture)), events = expand(state);
    expect(state.sessions).toHaveLength(1); expect(events).toHaveLength(8);
    expect(events.every(e => date(e.start).weekday === 1 && date(e.start).toFormat('HH:mm') === '10:00' && date(e.end).toFormat('HH:mm') === '12:00')).toBe(true);
    expect(events.every(e => date(e.start).weekday !== 5)).toBe(true);
    expect(new Set(events.map(e => e.id)).size).toBe(8);
    expect(local(events[0].start)).toBe('2026-09-28 10:00');
  });
  it('changes only week 2; later series edits keep its explicit exception', () => {
    let state = moved(imported(fixture)); const second = expand(state)[1];
    state = setException(state, second, { start: '2026-10-06T16:00:00+02:00', end: '2026-10-06T18:00:00+02:00', location: 'R02' });
    let events = expand(state); expect(local(events[1].start)).toBe('2026-10-06 16:00'); expect(events[1].id).toBe(second.id);
    expect(events.filter(e => date(e.start).weekday === 1)).toHaveLength(7);
    state = updateSeries(state, state.sessions[0].id, { weekday: 3, startTime: '09:00', endTime: '11:00' }, '2026-10-02', '2026-11-20');
    events = expand(state); expect(local(events[1].start)).toBe('2026-10-06 16:00'); expect(events[1].location).toBe('R02'); expect(events.filter(e => date(e.start).weekday === 3)).toHaveLength(7);
  });
  it('cancels week 3 and restores it to the current underlying schedule', () => {
    let state = moved(imported(fixture)); const third = expand(state)[2];
    state = setException(state, third, { cancelled: true }); expect(expand(state)).toHaveLength(7); expect(expand(state).some(e => e.id === third.id)).toBe(false);
    state = restoreOccurrence(state, third.id); expect(expand(state)).toHaveLength(8); expect(local(expand(state)[2].start)).toBe('2026-10-12 10:00');
  });
  it('reimports without duplicates and preserves edits, even when a removed UID later returns', () => {
    let state = moved(imported(fixture)); const second = expand(state)[1]; state = setException(state, second, { cancelled: true });
    const unchanged = previewImport(state, fixture, 'test.ics'); expect(unchanged.added).toBe(0); expect(unchanged.changed).toBe(0);
    state = applyImport(state, unchanged); expect(expand(state)).toHaveLength(7); expect(state.exceptions[second.id].cancelled).toBe(true);
    const modified = fixture.replaceAll('LOCATION:P01', 'LOCATION:P99');
    state = applyImport(state, previewImport(state, modified, 'test.ics')); expect(expand(state)).toHaveLength(7); expect(expand(state)[0].location).toBe('P99'); expect(local(expand(state)[0].start)).toBe('2026-09-28 10:00');
    state = applyImport(state, previewImport(state, wrap(event('other', '20261005')), 'test.ics'));
    state = applyImport(state, previewImport(state, fixture, 'test.ics')); expect(expand(state)).toHaveLength(7); expect(state.exceptions[second.id].cancelled).toBe(true); expect(state.sessions.filter(s => !s.removed)).toHaveLength(1);
  });
  it('round-trips all records and preferences to a fresh configuration', () => {
    let state = moved(imported(fixture)); state = setException(state, expand(state)[1], { start: '2026-10-06T16:00:00+02:00', end: '2026-10-06T18:00:00+02:00' });
    state.settings.accent = '#112233'; state.settings.labels.instructor = true; state.academics[0].breaks.push({ id: 'holiday', name: 'Break', start: '2026-12-25', end: '2027-01-01' });
    const transferred = parseConfig(serializeConfig(state)); expect(transferred).toEqual(state); expect(expand(transferred)).toEqual(expand(state));
  });
});
describe('recurrence edge cases', () => {
  it('keeps Ljubljana wall times across DST, with correct UTC offsets', () => {
    const events = expand(imported()); expect(events).toHaveLength(8);
    expect(events.map(e => date(e.start).toFormat('HH:mm'))).toEqual(Array(8).fill('13:00'));
    expect(date(events[3].start).offset).toBe(120); expect(date(events[4].start).offset).toBe(60);
    expect(new Date(events[3].start).getUTCHours()).toBe(11); expect(new Date(events[4].start).getUTCHours()).toBe(12);
  });
  it('interprets floating recurrences in the configured timezone, including an exact UTC UNTIL cutoff', () => {
    const floating = wrap('BEGIN:VEVENT\r\nUID:floating\r\nDTSTART:20261002T130000\r\nDTEND:20261002T150000\r\nRRULE:FREQ=WEEKLY;UNTIL=20261009T110000Z\r\nSUMMARY:Floating class\r\nEND:VEVENT');
    const state = imported(floating); expect(expand(state)).toHaveLength(2);
    state.settings.timezone = 'America/New_York';
    expect(expand(state)).toHaveLength(1);
    expect(date(expand(state)[0].start, 'America/New_York').hour).toBe(13);
    expect(state.sources[0].content).toContain('DTSTART:20261002T130000');
  });
  it('renders UTC-based imports at the correct displayed local time', () => {
    const utc = wrap('BEGIN:VEVENT\r\nUID:utc\r\nDTSTART:20261002T110000Z\r\nDTEND:20261002T130000Z\r\nSUMMARY:UTC class\r\nEND:VEVENT');
    expect(local(expand(imported(utc))[0].start)).toBe('2026-10-02 13:00');
  });
  it('moves a UTC occurrence across weekdays using its visible Ljubljana calendar week', () => {
    const source = wrap('BEGIN:VEVENT\r\nUID:utc-boundary\r\nDTSTART:20261004T230000Z\r\nDTEND:20261005T000000Z\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nSUMMARY:UTC boundary\r\nEND:VEVENT');
    let state = imported(source);
    state = updateSeries(state, state.sessions[0].id, { weekday: 2, startTime: '10:00', endTime: '11:00' }, '2026-10-04', '2026-10-18');
    expect(expand(state).map(e => local(e.start))).toEqual(['2026-10-06 10:00', '2026-10-13 10:00', '2026-10-20 10:00']);
  });
  it('generic weekly patterns include every BYDAY meeting', () => {
    const source = wrap('BEGIN:VEVENT\r\nUID:twice\r\nDTSTART;TZID=Europe/Ljubljana:20261005T100000\r\nDTEND;TZID=Europe/Ljubljana:20261005T120000\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=8\r\nSUMMARY:Twice weekly\r\nEND:VEVENT');
    const state = imported(source); expect(genericWeek(state, '2026-10-05').map(e => date(e.start).weekday)).toEqual([1, 3]);
  });
  it('matches renamed updated files by UID instead of duplicating the calendar source', () => {
    const state = moved(), changed = recurring.replace('LOCATION:P01', 'LOCATION:R99');
    const preview = previewImport(state, changed, 'renamed.ics'); expect(preview.sourceId).toBe(state.sources[0].id); expect(preview.differences).toHaveLength(1);
    const next = applyImport(state, preview); expect(next.sources).toHaveLength(1); expect(expand(next)).toHaveLength(8);
  });
  it('adds new individually listed weeks to the existing session on reimport', () => {
    let state = imported(individual);
    state = updateSeries(state, state.sessions[0].id, { weekday: 1, startTime: '10:00', endTime: '12:00' }, '2026-10-02', '2026-12-01');
    const updated = individual.replace('END:VCALENDAR', `${event('single-new', '20261127')}\r\nEND:VCALENDAR`);
    const preview = previewImport(state, updated, 'test.ics'); expect(preview.added).toBe(1);
    state = applyImport(state, preview); expect(state.courses).toHaveLength(1); expect(state.sessions).toHaveLength(1);
    const events = expand(state); expect(events).toHaveLength(9); expect(events.every(e => date(e.start).weekday === 1)).toBe(true);
  });
  it('separates recurring weekdays into independent sessions and preserves exceptions through reimport', () => {
    const source = wrap('BEGIN:VEVENT\r\nUID:twice\r\nDTSTART;TZID=Europe/Ljubljana:20261005T100000\r\nDTEND;TZID=Europe/Ljubljana:20261005T120000\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=8\r\nSUMMARY:Twice weekly\r\nLOCATION:R01\r\nEND:VEVENT');
    let state = imported(source), wednesday = expand(state)[1]; state = setException(state, wednesday, { cancelled: true });
    state = separateWeekday(state, state.sessions[0].id, 3);
    expect(state.sessions).toHaveLength(2); expect(expand(state)).toHaveLength(7);
    const separated = state.sessions[1]; state = updateSeries(state, separated.id, { weekday: 5, startTime: '14:00', endTime: '16:00' }, '2026-10-05', '2026-11-01');
    let events = expand(state); expect(events.filter(e => date(e.start).weekday === 1)).toHaveLength(4); expect(events.filter(e => date(e.start).weekday === 5)).toHaveLength(3); expect(events.some(e => date(e.start).weekday === 3)).toBe(false);
    state = applyImport(state, previewImport(state, source.replace('LOCATION:R01', 'LOCATION:R99'), 'test.ics'));
    events = expand(state); expect(events).toHaveLength(7); expect(events.every(e => e.location === 'R99')).toBe(true);
    expect(state.sessions.every(s => s.baselines.length === 1)).toBe(true); expect(Object.values(state.exceptions)[0].sessionId).toBe(separated.id);
    const transferred = parseConfig(serializeConfig(state)); expect(expand(transferred)).toEqual(events);
  });
  it('supports source RECURRENCE-ID, RDATE, EXDATE and cancelled exceptions', () => {
    const source = wrap(event('fridays', '20261002', 'RRULE:FREQ=WEEKLY;COUNT=4\r\nRDATE;TZID=Europe/Ljubljana:20261027T130000\r\nEXDATE;TZID=Europe/Ljubljana:20261016T130000\r\n') + '\r\n' +
      `BEGIN:VEVENT\r\nUID:fridays\r\nRECURRENCE-ID;TZID=Europe/Ljubljana:20261009T130000\r\nDTSTART;TZID=Europe/Ljubljana:20261010T160000\r\nDTEND;TZID=Europe/Ljubljana:20261010T180000\r\nSUMMARY:Moved class\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:fridays\r\nRECURRENCE-ID;TZID=Europe/Ljubljana:20261023T130000\r\nSTATUS:CANCELLED\r\nEND:VEVENT`);
    const events = expand(imported(source)); expect(events).toHaveLength(3); expect(events.map(e => local(e.start))).toEqual(['2026-10-02 13:00', '2026-10-10 16:00', '2026-10-27 13:00']);
    expect(events[1].originalKey).toBe('fridays|2026-10-09T13:00:00');
  });
  it('includes all explicit RDATE weeks in the default all-weeks edit range', () => {
    let state = imported(wrap(event('rdates', '20261002', 'RDATE;TZID=Europe/Ljubljana:20261009T130000,20261023T130000\r\n')));
    const range = sessionRange(state.sessions[0], state.settings.timezone); expect(range).toEqual({ from: '2026-10-02', to: '2026-10-23' });
    state = updateSeries(state, state.sessions[0].id, { weekday: 1, startTime: '10:00', endTime: '12:00' }, range.from, range.to);
    expect(expand(state)).toHaveLength(3); expect(expand(state).every(e => date(e.start).weekday === 1)).toBe(true);
    const excluded = imported(wrap(event('rdates', '20261002', 'RDATE;TZID=Europe/Ljubljana:20261009T130000,20261023T130000\r\nEXDATE;TZID=Europe/Ljubljana:20261002T130000\r\n')));
    expect(expand(excluded)).toHaveLength(2); expect(expand(excluded).some(e => e.originalDate === '2026-10-02')).toBe(false);
  });
  it('finds a user exception moved across years without displaying the original', () => {
    let state = imported(); const original = expand(state)[0];
    state = setException(state, original, { start: '2027-01-04T10:00:00+01:00', end: '2027-01-04T12:00:00+01:00' });
    expect(expand(state)).toHaveLength(7); const moved = expandCalendar(state, '2027-01-04', '2027-01-11'); expect(moved).toHaveLength(1); expect(moved[0].id).toBe(original.id);
  });
  it('finds an imported exception far outside its original recurrence range', () => {
    const source = wrap(event('fridays', '20261002', 'RRULE:FREQ=WEEKLY;COUNT=4\r\n') + '\r\nBEGIN:VEVENT\r\nUID:fridays\r\nRECURRENCE-ID;TZID=Europe/Ljubljana:20261009T130000\r\nDTSTART;TZID=Europe/Ljubljana:20270104T100000\r\nDTEND;TZID=Europe/Ljubljana:20270104T120000\r\nEND:VEVENT');
    const state = imported(source); expect(expand(state)).toHaveLength(3); expect(expandCalendar(state, '2027-01-04', '2027-01-11')).toHaveLength(1);
  });
  it('uses the regular session times when changing edit scope on a source exception', () => {
    const source = wrap(event('fridays', '20261002', 'RRULE:FREQ=WEEKLY;COUNT=4\r\n') + '\r\nBEGIN:VEVENT\r\nUID:fridays\r\nRECURRENCE-ID;TZID=Europe/Ljubljana:20261009T130000\r\nDTSTART;TZID=Europe/Ljubljana:20261010T160000\r\nDTEND;TZID=Europe/Ljubljana:20261010T180000\r\nEND:VEVENT');
    const state = imported(source), occurrence = expand(state)[1];
    expect(local(underlyingSessionOccurrence(state, occurrence)!.start)).toBe('2026-10-09 13:00');
  });
  it('applies this-and-future edits to original weeks and leaves earlier weeks alone', () => {
    const original = moved();
    const state = updateSeries(original, original.sessions[0].id, { weekday: 4, startTime: '16:00', endTime: '18:00' }, '2026-10-12', '2026-11-20');
    const events = expand(state);
    expect(events.slice(0, 2).every(e => date(e.start).weekday === 1)).toBe(true);
    expect(events.slice(2).every(e => date(e.start).weekday === 4 && date(e.start).hour === 16)).toBe(true);
  });
  it('restores a complete session, including cancellations and extras', () => {
    let state = moved(); state = setException(state, expand(state)[1], { cancelled: true });
    state = restoreSession(state, state.sessions[0].id); expect(expand(state)).toHaveLength(8); expect(expand(state).every(e => date(e.start).weekday === 5)).toBe(true);
  });
  it('preserves sparse imported weeks; weekly mode fills eligible weeks once', () => {
    const sparse = wrap(event('a', '20261002') + '\r\n' + event('b', '20261023'));
    let state = imported(sparse); expect(expand(state)).toHaveLength(2);
    state = updateSeries(state, state.sessions[0].id, { mode: 'weekly', weekday: 1, startTime: '10:00', endTime: '12:00' }, '2026-10-02', '2026-10-23');
    const events = expand(state); expect(events).toHaveLength(4); expect(new Set(events.map(e => e.start)).size).toBe(4);
    const generated = events[1]; state = setException(state, generated, { cancelled: true }); expect(expand(state)).toHaveLength(3);
  });
  it('keeps explicit classes while academic periods and breaks change', () => {
    const state = imported(); state.academics[0].breaks.push({ id: 'entire', name: 'No teaching', start: '2026-10-01', end: '2026-12-01' });
    expect(expand(state)).toHaveLength(8); expect(academicInfo('2026-10-05', state.academics[0]).week).toBe(2);
  });
  it('creates standalone sessions with finite recurrence and optional teaching constraints', () => {
    const state = createCourse(emptyState(), { title: 'Study group', location: 'Library', instructor: '', notes: '', label: 'SG', type: 'Personal', date: '2026-09-28', endDate: '2026-10-19', startTime: '17:00', endTime: '18:00', weekly: true, teachingOnly: true });
    expect(expand(state).map(e => local(e.start))).toEqual(['2026-10-05 17:00', '2026-10-12 17:00', '2026-10-19 17:00']);
  });
  it('does not merge similar names or different instructors', () => {
    const source = wrap(event('a', '20261002', '', 'X-INSTRUCTOR:A\r\n') + '\r\n' + event('b', '20261009', '', 'X-INSTRUCTOR:B\r\n'));
    expect(imported(source).sessions).toHaveLength(2);
  });
  it('reports unsupported records and retains their old baseline on partial reimport', () => {
    const state = imported(), source = wrap(event('fridays', '20261002', 'RRULE:FREQ=HOURLY;COUNT=100\r\n') + '\r\n' + event('valid', '20261005'));
    const preview = previewImport(state, source, 'test.ics'); expect(preview.warnings.join()).toContain('sub-daily'); expect(preview.removed).toHaveLength(0);
    expect(expand(applyImport(state, preview))).toHaveLength(9);
  });
  it('generic export excludes individual exceptions and one-off events', () => {
    let state = moved(); state = setException(state, expand(state)[1], { cancelled: true });
    const events = genericWeek(state, '2026-10-05'); expect(events).toHaveLength(1); expect(local(events[0].start)).toBe('2026-10-05 10:00');
  });
});
describe('configuration validation and safe merges', () => {
  it('merges identical exports without duplicates and surfaces conflicting records', () => {
    const state = moved(), incoming = parseConfig(serializeConfig(state)); expect(configurationConflicts(state, incoming)).toHaveLength(0);
    expect(mergeConfig(state, incoming, 'current')).toEqual(state);
    incoming.courses[0].name = 'Changed'; expect(configurationConflicts(state, incoming)).toHaveLength(1);
    expect(mergeConfig(state, incoming, 'current').courses[0].name).toBe(state.courses[0].name); expect(mergeConfig(state, incoming, 'incoming').courses[0].name).toBe('Changed');
  });
  it('rejects malformed files, invalid settings, duplicate IDs and broken references', () => {
    expect(() => parseConfig('bad')).toThrow('valid JSON'); const invalid = emptyState(); invalid.settings.maxTime = '05:00'; expect(() => serializeConfig(invalid)).toThrow('ascending');
    const state = imported(); state.courses.push({ ...state.courses[0] }); expect(() => serializeConfig(state)).toThrow('duplicated ID');
    expect(() => parseConfig('{"schemaVersion":9}')).toThrow('unsupported');
    expect(() => parseConfig('{"schemaVersion":1,"__proto__":{}}')).toThrow('unsafe');
  });
});
