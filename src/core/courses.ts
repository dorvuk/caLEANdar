import { sessionRange } from './engine';
import type { AppState, Course, Session } from './model';
import { uid } from './model';

export const sessionType = (session: Session, course: Course) => session.type ?? course.type;
export function courseTypes(state: AppState, course: Course): string[] {
  const types = state.sessions.filter(s => s.courseId === course.id && !s.deleted && !s.removed).map(s => sessionType(s, course));
  return [...new Set(types.length ? types : [course.type])];
}
export function moveSession(state: AppState, sessionId: string, targetId: string): AppState {
  const next = structuredClone(state), session = next.sessions.find(s => s.id === sessionId);
  const target = next.courses.find(c => c.id === targetId && !c.deleted), source = session && next.courses.find(c => c.id === session.courseId);
  if (!session || !source || !target) throw new Error('Choose an existing session and destination course.');
  if (source.id === target.id) return next;
  session.type ??= source.type;
  // Keep defaults the user set on the source course when it becomes part of a group.
  const metadata = Object.fromEntries((['location', 'instructor', 'notes'] as const).filter(k => source[k]).map(k => [k, source[k]]));
  if (Object.keys(metadata).length) {
    const range = sessionRange(session, next.settings.timezone);
    session.overrides.unshift({ id: uid(), ...range, patch: metadata });
  }
  session.courseId = target.id;
  return next;
}
export function groupCourses(state: AppState, targetId: string, sourceIds: string[]): AppState {
  let next = structuredClone(state);
  const target = next.courses.find(c => c.id === targetId && !c.deleted);
  if (!target) throw new Error('Choose an existing course to group under.');
  target.grouped = true;
  for (const session of next.sessions.filter(s => s.courseId === targetId)) session.type ??= target.type;
  for (const sourceId of new Set(sourceIds)) {
    if (sourceId === targetId) continue;
    const source = next.courses.find(c => c.id === sourceId && !c.deleted);
    if (!source) throw new Error('One of the courses is no longer available.');
    for (const session of next.sessions.filter(s => s.courseId === sourceId)) next = moveSession(next, session.id, targetId);
    next.courses.find(c => c.id === sourceId)!.deleted = true;
  }
  return next;
}
