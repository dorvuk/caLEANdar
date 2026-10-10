export type DateString = string;
export type View = 'timeGridWeek' | 'dayGridMonth' | 'timeGridDay';
export interface Metadata { title: string; location: string; instructor: string; notes: string }
export interface SchedulePatch extends Partial<Metadata> {
  weekday?: number; startTime?: string; endTime?: string;
  mode?: 'preserve' | 'weekly'; teachingOnly?: boolean;
}
export interface SeriesOverride { id: string; from: DateString; to: DateString; patch: SchedulePatch }
export interface OccurrenceOverride extends Partial<Metadata> {
  sessionId: string; originalKey: string; originalDate: DateString;
  start?: string; end?: string; cancelled?: boolean; original?: boolean;
}
export interface Course {
  id: string; name: string; importedName?: string; label: string; type: string;
  location: string; instructor: string; notes: string; visible: boolean; deleted?: boolean; color?: string; grouped?: boolean;
}
export interface Baseline { uid: string; ical: string; removed?: boolean }
export interface Session {
  id: string; courseId: string; sourceId?: string; baselines: Baseline[];
  overrides: SeriesOverride[]; deleted?: boolean; removed?: boolean;
  weekdays?: number[]; type?: string;
}
export interface Extra extends Metadata {
  id: string; sessionId: string; start: string; end: string; allDay: boolean;
}
export interface Source { id: string; name: string; content: string; importedAt: string }
export interface AcademicPeriod { id: string; name: string; start: string; end: string; kind: 'teaching' | 'exam' }
export interface Break { id: string; name: string; start: string; end: string }
export interface AcademicYear { id: string; name: string; periods: AcademicPeriod[]; breaks: Break[] }
export interface Settings {
  accent: string; theme: 'light' | 'dark'; font: 'mono' | 'system'; fontSize: number;
  eventFontSize: number; density: 'comfortable' | 'compact'; timezone: string;
  view: View; minTime: string; maxTime: string; weekends: boolean; firstDay: number;
  hour12: boolean; weekNumbers: boolean; academicOverlay: boolean; publicHolidays: boolean;
  academicYearId: string; types: string[];
  labels: { short: boolean; location: boolean; type: boolean; instructor: boolean; time: boolean; custom: string };
}
export interface AppState {
  schemaVersion: 1; sources: Source[]; courses: Course[]; sessions: Session[];
  exceptions: Record<string, OccurrenceOverride>; extras: Extra[];
  academics: AcademicYear[]; settings: Settings;
}
export interface Occurrence extends Metadata {
  id: string; sessionId: string; courseId: string; originalKey: string; originalDate: string;
  start: string; end: string; allDay: boolean; modified: boolean; extra?: boolean;
  baselineStart: string; baselineEnd: string;
}
export const uid = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
export const exceptionId = (sessionId: string, originalKey: string) => `${sessionId}::${originalKey}`;

export function emptyState(): AppState {
  return {
    schemaVersion: 1, sources: [], courses: [], sessions: [], exceptions: {}, extras: [],
    settings: {
      accent: '#304c3f', theme: 'light', font: 'mono', fontSize: 14, eventFontSize: 12,
      density: 'comfortable', timezone: 'Europe/Ljubljana', view: 'timeGridWeek',
      minTime: '07:00', maxTime: '21:00', weekends: false, firstDay: 1, hour12: false,
      weekNumbers: true, academicOverlay: true, publicHolidays: false, academicYearId: 'fri-2026-27',
      types: ['Lecture', 'Laboratory', 'Tutorial', 'Exam', 'Personal', 'Custom'],
      labels: { short: false, location: true, type: true, instructor: false, time: true, custom: '' },
    },
    academics: [{ id: 'fri-2026-27', name: 'FRI · 2026/27', breaks: [], periods: [
      { id: 'winter', name: 'Winter semester', start: '2026-10-01', end: '2027-01-15', kind: 'teaching' },
      { id: 'winter-exam', name: 'Winter examinations', start: '2027-01-19', end: '2027-02-12', kind: 'exam' },
      { id: 'summer', name: 'Summer semester', start: '2027-02-15', end: '2027-06-02', kind: 'teaching' },
      { id: 'spring-exam', name: 'Spring examinations', start: '2027-06-04', end: '2027-07-02', kind: 'exam' },
      { id: 'autumn-exam', name: 'Autumn examinations', start: '2027-08-16', end: '2027-09-10', kind: 'exam' },
    ] }],
  };
}
