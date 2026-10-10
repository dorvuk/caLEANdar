import { date } from './dates';
import type { AppState, Occurrence } from './model';
export function eventLabels(event: Occurrence, state: AppState): string[] {
  const course = state.courses.find(c => c.id === event.courseId), labels = state.settings.labels;
  const title = labels.short && course?.label ? course.label : event.title;
  const format = state.settings.hour12 ? 'h:mm a' : 'HH:mm';
  const start = date(event.start, state.settings.timezone), end = date(event.end, state.settings.timezone);
  const session = state.sessions.find(s => s.id === event.sessionId);
  const detail = [labels.location && event.location, labels.type && (session?.type ?? course?.type), labels.instructor && event.instructor].filter(Boolean).join(' · ');
  return [title, labels.time && !event.allDay ? `${start.toFormat(format)}–${end.toFormat(format)}` : '', detail, labels.custom].filter(Boolean) as string[];
}
