import { sessionRange } from './engine';
import type { AppState, Course, Session } from './model';
import { uid } from './model';

export const sessionType = (session: Session, course: Course) => session.type ?? course.type;
const defaultTypes = ['Lecture', 'Lectures', 'Laboratory', 'Laboratories', 'Lab', 'Labs', 'Tutorial', 'Tutorials', 'Seminar', 'Seminars', 'Practical', 'Practicals', 'Exam', 'Exams', 'Predavanja', 'Laboratorijske vaje', 'Avditorne vaje', 'LV', 'AV'];
export function courseName(name: string, types: string[] = []): string {
  const labels = [...new Set([...defaultTypes, ...types])].filter(Boolean).sort((a, b) => b.length - a.length).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const suffix = new RegExp(`(?:\\s*[—–·:|-]\\s*(?:${labels})|\\s*\\((?:${labels})\\)|\\s*\\[(?:${labels})\\])\\s*$`, 'i');
  return name.replace(suffix, '').trim().replace(/\s+/g, ' ') || name.trim();
}
export function courseTypes(state: AppState, course: Course): string[] {
  const types = state.sessions.filter(s => s.courseId === course.id && !s.deleted && !s.removed).map(s => sessionType(s, course));
  return [...new Set(types.length ? types : [course.type])];
}
export function moveSession(state: AppState, sessionId: string, targetId: string): AppState {
  const next = structuredClone(state);
  moveSessionInPlace(next, sessionId, targetId);
  return next;
}
function moveSessionInPlace(next: AppState, sessionId: string, targetId: string): void {
  const session = next.sessions.find(s => s.id === sessionId);
  const target = next.courses.find(c => c.id === targetId && !c.deleted), source = session && next.courses.find(c => c.id === session.courseId);
  if (!session || !source || !target) throw new Error('Choose an existing session and destination course.');
  if (source.id === target.id) return;
  session.type ??= source.type;
  // Keep defaults the user set on the source course when it becomes part of a group.
  const metadata = Object.fromEntries((['location', 'instructor', 'notes'] as const).filter(k => source[k]).map(k => [k, source[k]]));
  if (Object.keys(metadata).length) {
    const range = sessionRange(session, next.settings.timezone);
    session.overrides.unshift({ id: uid(), ...range, patch: metadata });
  }
  session.courseId = target.id;
  target.grouped = true;
}
export function groupCourses(state: AppState, targetId: string, sourceIds: string[]): AppState {
  const next = structuredClone(state);
  groupCoursesInPlace(next, targetId, sourceIds);
  return next;
}
function groupCoursesInPlace(next: AppState, targetId: string, sourceIds: string[]): void {
  const target = next.courses.find(c => c.id === targetId && !c.deleted);
  if (!target) throw new Error('Choose an existing course to group under.');
  target.grouped = true; target.autoGroup = true;
  for (const session of next.sessions.filter(s => s.courseId === targetId)) session.type ??= target.type;
  // Course defaults belong to their original sessions, rather than replacing other rooms or instructors.
  const metadata = Object.fromEntries((['location', 'instructor', 'notes'] as const).filter(k => target[k]).map(k => [k, target[k]]));
  if (Object.keys(metadata).length) {
    for (const session of next.sessions.filter(s => s.courseId === targetId)) session.overrides.unshift({ id: uid(), ...sessionRange(session, next.settings.timezone), patch: metadata });
    target.location = ''; target.instructor = ''; target.notes = '';
  }
  for (const sourceId of new Set(sourceIds)) {
    if (sourceId === targetId) continue;
    const source = next.courses.find(c => c.id === sourceId && !c.deleted);
    if (!source) throw new Error('One of the courses is no longer available.');
    for (const session of next.sessions.filter(s => s.courseId === sourceId)) moveSessionInPlace(next, session.id, targetId);
    next.courses.find(c => c.id === sourceId)!.deleted = true;
  }
}

export function autoGroupCourses(state: AppState): AppState {
  const matches = new Map<string, { name: string; courses: Course[] }>();
  for (const course of state.courses) {
    if (course.deleted || course.autoGroup === false) continue;
    const name = courseName(course.name, state.settings.types), key = name.normalize('NFC').toLowerCase();
    const match = matches.get(key) ?? { name, courses: [] };
    match.courses.push(course); matches.set(key, match);
  }
  let next = state;
  for (const { name, courses } of matches.values()) {
    if (courses.length < 2) continue;
    const target = courses.find(c => c.grouped) ?? courses.find(c => c.color) ?? courses[0];
    if (next === state) next = structuredClone(state);
    groupCoursesInPlace(next, target.id, courses.filter(c => c.id !== target.id).map(c => c.id));
    const grouped = next.courses.find(c => c.id === target.id)!;
    grouped.name = name; grouped.visible = courses.some(c => c.visible);
  }
  return next;
}

export function ungroupCourse(state: AppState, courseId: string): AppState {
  const next = structuredClone(state), course = next.courses.find(c => c.id === courseId && !c.deleted);
  if (!course) throw new Error('Choose an existing course to ungroup.');
  const sessions = next.sessions.filter(s => s.courseId === courseId);
  if (sessions.length < 2) throw new Error('This course has only one session.');
  const types = [...new Set(sessions.map(s => sessionType(s, course)))], name = courseName(course.name, next.settings.types);
  const groups = types.length > 1 ? types.map(type => ({ type, sessions: sessions.filter(s => sessionType(s, course) === type) })) : sessions.map((session, i) => ({ type: types[0], sessions: [session], number: i + 1 }));
  const original = { ...course };
  groups.forEach((group, i) => {
    const suffix = 'number' in group ? `${group.type} ${group.number}` : group.type;
    const separate: Course = { ...original, id: i === 0 ? courseId : uid(), name: `${name} · ${suffix}`, type: group.type, grouped: false, autoGroup: false };
    // Keep these chosen names when the original source is imported again.
    delete separate.importedName;
    if (i === 0) Object.assign(course, separate); else next.courses.push(separate);
    if (i === 0) delete course.importedName;
    for (const session of group.sessions) { session.type = group.type; session.courseId = separate.id; }
  });
  return next;
}

export function separateSession(state: AppState, sessionId: string): AppState {
  const next = structuredClone(state), session = next.sessions.find(s => s.id === sessionId);
  const course = session && next.courses.find(c => c.id === session.courseId && !c.deleted);
  if (!session || !course) throw new Error('Choose an existing session to separate.');
  const type = sessionType(session, course);
  const separate: Course = { ...course, id: uid(), name: `${courseName(course.name, next.settings.types)} · ${type}`, type, grouped: false, autoGroup: false };
  delete separate.importedName;
  course.autoGroup = false;
  next.courses.push(separate); session.type = type; session.courseId = separate.id;
  return next;
}
