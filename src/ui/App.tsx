import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import FullCalendar from '@fullcalendar/react';
import type { DatesSetArg } from '@fullcalendar/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { academicInfo, addDays, date, monday, today } from '../core/dates';
import { emptyState, type AppState, type Occurrence, type View } from '../core/model';
import { desktop, loadState, openFile, readDrop, saveState } from '../platform/storage';
import Calendar from './Calendar';
import MiniCalendar from './MiniCalendar';
import { CourseDialog, CreateDialog, EventDialog } from './EditDialogs';
import { ConfigDialog, ExportDialog, ImportDialog, SettingsDialog } from './UtilityDialogs';
import { Icon } from './shared';
import sample from '../../samples/fri-sample.ics?raw';

type Dialog = { kind: 'create'; day: string; time?: string; courseId?: string } | { kind: 'event'; event: Occurrence; proposed?: { start: string; end: string } } | { kind: 'course'; id: string } | { kind: 'import' | 'config'; file: { name: string; content: string } } | { kind: 'settings'; tab?: string } | { kind: 'export' };
export default function App() {
  const [state, setState] = useState<AppState>(emptyState), [ready, setReady] = useState(false), [error, setError] = useState('');
  const [anchor, setAnchor] = useState(today('Europe/Ljubljana')), [view, setView] = useState<View>('timeGridWeek');
  const [range, setRange] = useState({ start: monday(anchor), end: addDays(monday(anchor), 7) });
  const [dialog, setDialog] = useState<Dialog | null>(null), [search, setSearch] = useState(''), [notice, setNotice] = useState(''), [saving, setSaving] = useState(false), [dragging, setDragging] = useState(false);
  const calendarRef = useRef<FullCalendar>(null), pendingSave = useRef(false);
  const onClose = useCallback(() => setDialog(null), []);
  useEffect(() => { let active = true; loadState().then(s => { if (active) { setState(s); setView(s.settings.view); setAnchor(today(s.settings.timezone)); } }).catch(e => { if (active) setError(`Cannot load the saved calendar: ${e instanceof Error ? e.message : String(e)}`); }).finally(() => { if (active) setReady(true); }); return () => { active = false; }; }, []);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(t); }, [notice]);
  useEffect(() => { if (!ready) return; calendarRef.current?.getApi().changeView(state.settings.view); setView(state.settings.view); }, [ready, state.settings.view]);
  const commit = useCallback(async (next: AppState, reason: string) => {
    if (pendingSave.current) throw new Error('Another change is being saved. Try again in a moment.');
    pendingSave.current = true; setSaving(true);
    try { await saveState(next, reason); setState(next); setError(''); setNotice('Saved locally.'); }
    finally { pendingSave.current = false; setSaving(false); }
  }, []);
  function acceptFile(file: { name: string; content: string }) { setDialog({ kind: file.name.toLowerCase().endsWith('.json') ? 'config' : 'import', file }); }
  const pickImport = async (kind: 'calendar' | 'configuration' = 'calendar') => { try { const file = await openFile(kind); if (file) acceptFile(file); } catch (e) { setError(String(e)); } };
  useEffect(() => {
    if (!desktop) return;
    let unlisten: (() => void) | undefined, disposed = false;
    getCurrentWebviewWindow().onDragDropEvent(async e => {
      setDragging(e.payload.type === 'over' || e.payload.type === 'enter');
      if (e.payload.type === 'drop') {
        setDragging(false);
        if (e.payload.paths.length !== 1) { setError('Drop one timetable or configuration file at a time.'); return; }
        try { const file = await readDrop(e.payload.paths[0]); acceptFile(file); } catch (e) { setError(String(e)); }
      }
    }).then(fn => { if (disposed) fn(); else unlisten = fn; }).catch(e => setError(String(e)));
    return () => { disposed = true; unlisten?.(); };
  }, []);
  const goTo = (day: string) => { setAnchor(day); calendarRef.current?.getApi().gotoDate(day); };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (dialog || e.ctrlKey || e.metaKey || e.altKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;
      if (e.key.toLowerCase() === 'n') { e.preventDefault(); setDialog({ kind: 'create', day: anchor }); }
      if (e.key.toLowerCase() === 't') goTo(today(state.settings.timezone));
      if (e.key === 'ArrowLeft') calendarRef.current?.getApi().prev();
      if (e.key === 'ArrowRight') calendarRef.current?.getApi().next();
    };
    document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key);
  }, [dialog, anchor, state.settings.timezone]);
  const onDates = useCallback((arg: DatesSetArg) => {
    setRange({ start: arg.startStr, end: arg.endStr });
    const api = calendarRef.current?.getApi(); if (api) setAnchor(date(api.getDate().toISOString(), state.settings.timezone).toISODate()!);
  }, [state.settings.timezone]);
  const activeYear = state.academics.find(y => y.id === state.settings.academicYearId), academic = academicInfo(anchor, activeYear);
  const courses = state.courses.filter(c => !c.deleted && c.name.toLowerCase().includes(search.toLowerCase()));
  const weekStart = monday(anchor), weekEnd = addDays(weekStart, 6);
  const first = date(view === 'timeGridWeek' ? range.start.slice(0, 10) : weekStart), last = date(view === 'timeGridWeek' ? addDays(range.end.slice(0, 10), -1) : weekEnd);
  const weekTitle = first.month === last.month && first.year === last.year ? `${first.toFormat('d')}–${last.toFormat('d MMMM yyyy')}` : `${first.toFormat(first.year === last.year ? 'd MMM' : 'd MMM yyyy')} – ${last.toFormat('d MMM yyyy')}`;
  const title = view === 'dayGridMonth' ? date(anchor).toFormat('MMMM yyyy') : view === 'timeGridDay' ? date(anchor).toFormat('d MMMM yyyy') : weekTitle;
  const style = { '--accent': state.settings.accent, '--font-size': `${state.settings.fontSize}px`, '--ui-scale': state.settings.fontSize / 14, '--event-font-size': `${state.settings.eventFontSize}px` } as CSSProperties;
  if (!ready) return <div className="loading"><Icon name="calendar" size={32} /><p>Opening your calendar…</p></div>;
  return <div className={`app ${state.settings.theme} ${state.settings.font} ${state.settings.density}`} style={style}
    onDragOver={e => { if (!desktop && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }}
    onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
    onDrop={async e => { if (desktop) return; e.preventDefault(); setDragging(false); const file = e.dataTransfer.files[0]; if (file) { if (file.size > 40_000_000) { setError('Files must be smaller than 40 MB.'); return; } acceptFile({ name: file.name, content: await file.text() }); } }}>
    <aside className="sidebar">
      <div className="brand"><div className="brand-icon"><Icon name="calendar" size={21} /></div><span>ca<span className="brand-lean">LEAN</span>dar<span className="brand-dot">.</span></span></div>
      <div className="tagline">A LITTLE ORDER.</div>
      <button className="primary add-course" title="New course (N)" onClick={() => setDialog({ kind: 'create', day: anchor })}><Icon name="plus" />New course<span className="shortcut">N</span></button>
      <MiniCalendar selected={anchor} onSelect={goTo} today={today(state.settings.timezone)} firstDay={state.settings.firstDay} />
      <div className="sidebar-section"><div className="section-label"><span>MY COURSES</span><span>{state.courses.filter(c => !c.deleted).length.toString().padStart(2, '0')}</span></div><input className="course-search" type="search" aria-label="Filter courses" placeholder="Find a course…" value={search} onChange={e => setSearch(e.target.value)} /></div>
      <div className="course-list">{courses.map(c => <div className={`course-row ${!c.visible ? 'course-hidden' : ''}`} key={c.id}>
        <label className="visibility" title={c.visible ? `Hide ${c.name}` : `Show ${c.name}`}><input type="checkbox" aria-label={`Show ${c.name}`} checked={c.visible} disabled={saving} onChange={async e => { const next = structuredClone(state); next.courses.find(v => v.id === c.id)!.visible = e.target.checked; try { await commit(next, 'Change course visibility'); } catch (e) { setError(String(e)); } }} /><span><Icon name="check" size={11} /></span></label>
        <button onClick={() => setDialog({ kind: 'course', id: c.id })}><strong>{c.label || c.name}</strong><small>{c.type} · {state.sessions.filter(s => s.courseId === c.id && !s.deleted && !s.removed).length} session{state.sessions.filter(s => s.courseId === c.id && !s.deleted && !s.removed).length === 1 ? '' : 's'}</small></button>
      </div>)}{!courses.length && <p className="sidebar-empty">{search ? 'No matching courses.' : 'Your courses will feel at home here.'}</p>}</div>
      <div className="sidebar-bottom"><button className="import-button" onClick={() => pickImport()}><Icon name="upload" />Import timetable<span>.ics</span></button><button className="settings-button" onClick={() => setDialog({ kind: 'settings' })}><Icon name="settings" />Settings & data</button><div className="local-status"><span className="status-dot" /><span>{desktop ? saving ? 'SAVING LOCALLY' : 'LOCAL · OFFLINE READY' : 'BROWSER PREVIEW'}</span><span>v1.0</span></div></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="breadcrumb"><Icon name="book" size={13} /><span>MY TIMETABLE</span><span className="slash">/</span><span>{activeYear?.name ?? 'Personal calendar'}</span></div><div className="topbar-actions"><span className="local-note">{state.settings.timezone.replace('Europe/', '')}</span><button onClick={() => setDialog({ kind: 'export' })}><Icon name="download" />Export PNG</button></div></header>
      {error && <div className="app-error" role="alert"><span>{error}</span><button onClick={() => setDialog({ kind: 'settings', tab: 'recovery' })}>Recovery</button><button className="icon-button" onClick={() => setError('')} aria-label="Dismiss error"><Icon name="close" /></button></div>}
      <div className="calendar-toolbar"><div><div className="eyebrow">{state.settings.weekNumbers ? `WEEK ${date(anchor).weekNumber.toString().padStart(2, '0')}` : 'YOUR CALENDAR'}{state.settings.academicOverlay && academic.week ? ` / TEACHING WEEK ${academic.week.toString().padStart(2, '0')}` : ''}</div><h1>{title}</h1><div className="semester-line"><span className="small-pixel" />{state.settings.academicOverlay ? academic.pause?.name ?? academic.period?.name ?? 'Outside academic periods' : 'Your time, your way.'}</div></div>
        <div className="calendar-controls"><div className="navigation-controls"><button title="Previous period (←)" aria-label="Previous period" className="icon-button" onClick={() => calendarRef.current?.getApi().prev()}><Icon name="left" /></button><button title="Today (T)" onClick={() => goTo(today(state.settings.timezone))}>Today</button><button title="Next period (→)" aria-label="Next period" className="icon-button" onClick={() => calendarRef.current?.getApi().next()}><Icon name="right" /></button><input type="date" value={anchor} aria-label="Jump to date" onChange={e => { if (e.target.value) goTo(e.target.value); }} /></div><div className="view-switch">{[['timeGridWeek', 'Week'], ['dayGridMonth', 'Month'], ['timeGridDay', 'Day']].map(([v, label]) => <button key={v} className={view === v ? 'active' : ''} aria-pressed={view === v} onClick={() => { setView(v as View); calendarRef.current?.getApi().changeView(v); }}>{label}</button>)}</div></div>
      </div>
      <div className="calendar-frame"><Calendar state={state} range={range} calendarRef={calendarRef} onDates={onDates} onEvent={event => setDialog({ kind: 'event', event })} onCreate={(day, time) => setDialog({ kind: 'create', day, time })} onMove={(event, start, end) => setDialog({ kind: 'event', event, proposed: { start, end } })} /></div>
      <footer className="calendar-footer"><div><span className="legend-square" />Class<span className="legend-square modified" />Edited{state.settings.academicOverlay && <><span className="legend-square teaching" />Teaching<span className="legend-square exam" />Exams</>}</div><span>SELECT TO ADD · CLICK TO EDIT · DRAG TO MOVE</span></footer>
      {!state.sources.length && !state.courses.length && <div className="welcome-strip"><span>Try a little structure.</span><button className="text-button" onClick={() => setDialog({ kind: 'import', file: { name: 'fri-sample.ics', content: sample } })}>Preview the sample timetable <Icon name="arrow" size={13} /></button></div>}
    </main>
    {notice && <div className="toast" role="status"><Icon name="check" />{notice}</div>}
    {dragging && <div className="drop-overlay"><Icon name="upload" size={40} /><h2>Drop your timetable here.</h2><p>.ics / .ical / configuration .json</p></div>}
    {dialog?.kind === 'create' && <CreateDialog state={state} day={dialog.day} time={dialog.time} courseId={dialog.courseId} commit={commit} onClose={onClose} />}
    {dialog?.kind === 'event' && <EventDialog state={state} event={dialog.event} proposed={dialog.proposed} commit={commit} onClose={onClose} onCourse={() => setDialog({ kind: 'course', id: dialog.event.courseId })} />}
    {dialog?.kind === 'course' && state.courses.find(c => c.id === dialog.id) && <CourseDialog state={state} course={state.courses.find(c => c.id === dialog.id)!} commit={commit} onClose={onClose} onAddSession={() => setDialog({ kind: 'create', day: anchor, courseId: dialog.id })} />}
    {dialog?.kind === 'import' && <ImportDialog state={state} file={dialog.file} commit={commit} onClose={onClose} onImported={goTo} />}
    {dialog?.kind === 'config' && <ConfigDialog state={state} file={dialog.file} commit={commit} onClose={onClose} />}
    {dialog?.kind === 'settings' && <SettingsDialog state={state} commit={commit} onClose={onClose} initialTab={dialog.tab} onImportConfig={() => pickImport('configuration')} />}
    {dialog?.kind === 'export' && <ExportDialog state={state} selected={anchor} onClose={onClose} />}
  </div>;
}
