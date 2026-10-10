import { expect, it } from 'vitest';
import { applyImport, previewImport } from '../src/core/importer';
import { emptyState } from '../src/core/model';
import { createCourse, expandCalendar, setException, updateSeries } from '../src/core/engine';
import { autoGroupCourses, courseName, courseTypes, groupCourses, moveSession, separateSession, ungroupCourse } from '../src/core/courses';
import { eventLabels } from '../src/core/labels';
import { parseConfig, serializeConfig } from '../src/core/config';
import { renderTimetableSvg } from '../src/core/png';
import { courseColors } from '../src/core/colors';
import { recurring, wrap, event } from './fixtures';

const source = wrap(event('lecture', '20261002', 'RRULE:FREQ=WEEKLY;COUNT=8\r\n').replace('Course 1', 'Algorithms — Lectures') + '\r\n' + event('lab', '20261006', 'RRULE:FREQ=WEEKLY;COUNT=8\r\n').replace('Course 1', 'Algorithms — Laboratory'));
it('automatically groups matching lecture and lab names while retaining session types and edits through reimport and transfer', () => {
  let state = applyImport(emptyState(), previewImport(emptyState(), source, 'test.ics'));
  expect(state.courses.filter(c => !c.deleted)).toHaveLength(1);
  expect(state.courses[0].name).toBe('Algorithms');
  const lecture = state.courses[0];
  const session = state.sessions[0];
  state = updateSeries(state, session.id, { weekday: 1, startTime: '10:00', endTime: '12:00' }, '2026-10-02', '2026-12-01');
  const occurrence = expandCalendar(state, '2026-10-05', '2026-10-12').find(e => e.sessionId === session.id)!;
  state = setException(state, occurrence, { start: '2026-10-06T16:00:00+02:00', end: '2026-10-06T18:00:00+02:00' });
  state.courses[0].color = '#9852bd';
  expect(autoGroupCourses(state)).toBe(state);
  expect(state.courses.filter(c => !c.deleted)).toHaveLength(1);
  expect(courseTypes(state, state.courses[0])).toEqual(['Lecture', 'Laboratory']);
  const events = expandCalendar(state, '2026-10-05', '2026-10-12');
  expect(events).toHaveLength(2); expect(new Set(events.map(e => e.id)).size).toBe(2);
  expect(eventLabels(events.find(e => e.sessionId === session.id)!, state).join(' ')).toContain('Lecture');
  expect(eventLabels(events.find(e => e.sessionId !== session.id)!, state).join(' ')).toContain('Laboratory');
  state = applyImport(state, previewImport(state, source.replaceAll('LOCATION:P01', 'LOCATION:R99'), 'test.ics'));
  expect(state.courses[0].name).toBe(lecture.name);
  expect(state.courses[0].color).toBe('#9852bd'); expect(state.courses.filter(c => !c.deleted)).toHaveLength(1);
  const updated = expandCalendar(state, '2026-10-05', '2026-10-12');
  expect(updated).toHaveLength(2); expect(updated.every(e => e.location === 'R99')).toBe(true);
  expect(updated.find(e => e.id === occurrence.id)!.start).toContain('16:00');
  expect(expandCalendar(parseConfig(serializeConfig(state)), '2026-10-05', '2026-10-12')).toEqual(updated);
});
it('moves a legacy session without losing its original type or metadata defaults', () => {
  const separateSource = source.replace('Algorithms — Laboratory', 'Advanced Algorithms — Laboratory');
  const state = applyImport(emptyState(), previewImport(emptyState(), separateSource, 'test.ics'));
  state.courses[1].location = 'Custom room';
  const next = moveSession(state, state.sessions[1].id, state.courses[0].id);
  const lab = expandCalendar(next, '2026-10-05', '2026-10-12').find(e => e.sessionId === state.sessions[1].id)!;
  expect(lab.location).toBe('Custom room'); expect(eventLabels(lab, next).join(' ')).toContain('Laboratory');
});
it('ungroups by session type and keeps sessions, edits, colors and separation through reimport and JSON transfer', () => {
  let state = applyImport(emptyState(), previewImport(emptyState(), source, 'test.ics'));
  state.courses[0].color = '#9852bd';
  const occurrence = expandCalendar(state, '2026-10-05', '2026-10-12')[0];
  state = setException(state, occurrence, { start: '2026-10-07T16:00:00+02:00', end: '2026-10-07T18:00:00+02:00' });
  const before = expandCalendar(state, '2026-10-05', '2026-10-12');
  const split = ungroupCourse(state, state.courses[0].id);
  expect(split.courses.filter(c => !c.deleted).map(c => c.name)).toEqual(['Algorithms · Lecture', 'Algorithms · Laboratory']);
  expect(split.courses.filter(c => !c.deleted).every(c => c.color === '#9852bd' && c.autoGroup === false)).toBe(true);
  expect(split.exceptions).toEqual(state.exceptions);
  expect(split.sessions.map(s => s.id)).toEqual(state.sessions.map(s => s.id));
  const updated = applyImport(parseConfig(serializeConfig(split)), previewImport(split, source.replaceAll('LOCATION:P01', 'LOCATION:R99'), 'test.ics'));
  expect(updated.courses.filter(c => !c.deleted)).toHaveLength(2);
  expect(autoGroupCourses(updated)).toBe(updated);
  const after = expandCalendar(updated, '2026-10-05', '2026-10-12');
  expect(after.map(e => [e.id, e.start, e.end])).toEqual(before.map(e => [e.id, e.start, e.end]));
  expect(after.every(e => e.location === 'R99')).toBe(true);
  const courses = updated.courses.filter(c => !c.deleted);
  expect(groupCourses(updated, courses[0].id, [courses[1].id]).courses.filter(c => !c.deleted)).toHaveLength(1);
});
it('groups equal names with category types, normalized suffixes and custom types without combining different course names', () => {
  const initial = emptyState(); initial.settings.types.push('Workshop');
  const categorySource = wrap(['Lecture', 'Laboratory', 'Tutorial', 'Workshop'].map((type, i) => event(`category-${i}`, `2026100${i + 5}`, 'RRULE:FREQ=WEEKLY;COUNT=4\r\n', `CATEGORIES:${type}\r\n`).replace('Course 1', 'Statistics')).join('\r\n'));
  const grouped = applyImport(initial, previewImport(initial, categorySource, 'types.ics'));
  expect(grouped.courses.filter(c => !c.deleted)).toHaveLength(1);
  expect(courseTypes(grouped, grouped.courses[0])).toEqual(['Lecture', 'Laboratory', 'Tutorial', 'Workshop']);
  expect(courseName('  Statistics   (Tutorial)  ')).toBe('Statistics');
  expect(courseName('Statistics · Workshop', initial.settings.types)).toBe('Statistics');
  const different = wrap(event('one', '20261005').replace('Course 1', 'Statistics 1') + '\r\n' + event('two', '20261006').replace('Course 1', 'Statistics 2'));
  expect(applyImport(initial, previewImport(initial, different, 'different.ics')).courses.filter(c => !c.deleted)).toHaveLength(2);
});
it('automatically groups newly created matching courses and separates a single session without immediately regrouping', () => {
  const input = { title: 'Statistics', location: 'Lecture room', instructor: '', notes: '', label: '', type: 'Lecture', date: '2026-10-05', endDate: '2027-01-15', startTime: '09:00', endTime: '10:00', weekly: true, teachingOnly: false };
  const lecture = createCourse(emptyState(), input);
  const grouped = createCourse(lecture, { ...input, type: 'Laboratory', date: '2026-10-06', location: 'Lab room' });
  expect(grouped.courses.filter(c => !c.deleted)).toHaveLength(1);
  expect(courseTypes(grouped, grouped.courses[0])).toEqual(['Lecture', 'Laboratory']);
  expect(expandCalendar(grouped, '2026-10-05', '2026-10-12').map(e => e.location)).toEqual(['Lecture room', 'Lab room']);
  const separated = separateSession(grouped, grouped.sessions[1].id);
  expect(autoGroupCourses(separated)).toBe(separated);
  expect(separated.courses.filter(c => !c.deleted)).toHaveLength(2);
});
it('validates and includes course colors in both export modes without changing old configurations', () => {
  const state = applyImport(emptyState(), previewImport(emptyState(), recurring, 'test.ics'));
  expect(parseConfig(serializeConfig(state))).toEqual(state);
  state.courses[0].color = '#dd782a';
  const colors = courseColors('#dd782a', false);
  for (const generic of [false, true]) {
    const image = renderTimetableSvg(state, { week: '2026-10-05', generic, weekends: false, minTime: '07:00', maxTime: '21:00', scale: 1 });
    expect(image.svg).toContain(`fill="${colors.background}"`); expect(image.svg).toContain(`stroke="${colors.border}"`);
    expect(image.svg).toContain('Minecraft'); expect(image.svg).toContain('data:font/otf;base64,');
  }
  state.courses[0].color = 'red'; expect(() => serializeConfig(state)).toThrow('course color');
});
it('creates the full selected duration, including a selection ending on the next day', () => {
  const input = { title: 'Selected class', location: '', instructor: '', notes: '', label: '', type: 'Personal', date: '2026-10-05', endDate: '2026-10-05', startTime: '09:30', endTime: '12:00', weekly: false, teachingOnly: false };
  const state = createCourse(emptyState(), input);
  let e = expandCalendar(state, '2026-10-05', '2026-10-12')[0];
  expect(e.start).toContain('09:30'); expect(e.end).toContain('12:00');
  const overnight = createCourse(emptyState(), { ...input, startTime: '23:00', endTime: '01:00', endDay: '2026-10-06' });
  e = expandCalendar(overnight, '2026-10-05', '2026-10-12')[0];
  expect(e.start).toContain('2026-10-05T23:00'); expect(e.end).toContain('2026-10-06T01:00');
});
