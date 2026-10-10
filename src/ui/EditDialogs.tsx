import { useState } from 'react';
import { createCourse, effectivePatch, restoreOccurrence, restoreSession, separateWeekday, sessionRange, sessionWeekdays, setException, underlyingSessionOccurrence, updateSeries, type NewCourseInput } from '../core/engine';
import { addDays, date, localInput, monday, wallTime } from '../core/dates';
import { uid, type AppState, type Course, type Occurrence } from '../core/model';
import { courseName, courseTypes, groupCourses, moveSession, separateSession, sessionType, ungroupCourse } from '../core/courses';
import { ErrorText, Field, Icon, Modal, Toggle } from './shared';

export type Commit = (next: AppState, reason: string) => Promise<void>;
const message = (e: unknown) => e instanceof Error ? e.message : String(e);
export function CreateDialog({ state, day, selection, courseId, commit, onClose }: { state: AppState; day: string; selection?: { start: string; end: string }; courseId?: string; commit: Commit; onClose: () => void }) {
  const existing = state.courses.find(c => c.id === courseId);
  const start = selection ? date(selection.start, state.settings.timezone) : date(`${day}T09:00`, state.settings.timezone);
  const end = selection ? date(selection.end, state.settings.timezone) : start.plus({ hours: 1 });
  const [form, setForm] = useState<NewCourseInput>({ title: existing?.name ?? '', label: existing?.label ?? '', type: existing?.type ?? 'Lecture', location: existing?.location ?? '', instructor: existing?.instructor ?? '', notes: '', date: day, endDate: day < '2027-01-15' ? '2027-01-15' : date(day).plus({ months: 4 }).toISODate()!, startTime: start.toFormat('HH:mm'), endTime: end.toFormat('HH:mm'), endDay: end.toISODate() !== day ? end.toISODate()! : undefined, weekly: true, teachingOnly: false, courseId });
  const [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const set = <K extends keyof NewCourseInput>(k: K, v: NewCourseInput[K]) => setForm({ ...form, [k]: v, ...(k === 'date' && form.endDay ? { endDay: addDays(String(v), date(form.endDay).diff(date(form.date), 'days').days) } : {}) });
  return <Modal title={courseId ? 'Add a session' : 'Make room for something.'} subtitle="NEW COURSE" onClose={onClose}>
    <form onSubmit={async e => { e.preventDefault(); setSaving(true); try { await commit(createCourse(state, form), 'Create course'); onClose(); } catch (e) { setError(message(e)); } finally { setSaving(false); } }}>
      <div className="modal-body">
        <Field label="Course or activity name"><input autoFocus required value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Algorithms & data structures" /></Field>
        <div className="form-row"><Field label="Short label"><input value={form.label} onChange={e => set('label', e.target.value)} placeholder="e.g. ADS" /></Field><Field label="Type"><select value={form.type} onChange={e => set('type', e.target.value)}>{state.settings.types.map(t => <option key={t}>{t}</option>)}</select></Field></div>
        <div className="form-row"><Field label={form.weekly ? 'First session' : 'Date'}><input type="date" required value={form.date} onChange={e => set('date', e.target.value)} /></Field>{form.weekly && <Field label="Last eligible date"><input type="date" required min={form.date} value={form.endDate} onChange={e => set('endDate', e.target.value)} /></Field>}</div>
        <div className="form-row"><Field label="Starts"><input type="time" required value={form.startTime} onChange={e => set('startTime', e.target.value)} /></Field><Field label="Ends"><input type="time" required value={form.endTime} onChange={e => set('endTime', e.target.value)} /></Field></div>
        {form.endDay && <Field label="Session ends on"><input type="date" required min={form.date} value={form.endDay} onChange={e => set('endDay', e.target.value)} /></Field>}
        {!courseId && <CourseColor value={form.color} accent={state.settings.accent} onChange={v => set('color', v)} />}
        <Toggle label="Repeat every week" checked={form.weekly} onChange={v => set('weekly', v)} />
        {form.weekly && <Toggle label="Generate only on teaching dates in my selected academic year" checked={form.teachingOnly} onChange={v => set('teachingOnly', v)} />}
        <div className="form-row"><Field label="Location"><input value={form.location} onChange={e => set('location', e.target.value)} placeholder="Room, building, or anywhere" /></Field><Field label="Instructor (optional)"><input value={form.instructor} onChange={e => set('instructor', e.target.value)} /></Field></div>
        <Field label="Notes"><textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} /></Field>
        <p className="hint">Times follow {state.settings.timezone}. Teaching constraints apply when the session is created; changing academic settings later keeps your classes.</p><ErrorText error={error} />
      </div>
      <footer className="modal-footer"><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={saving}>{saving ? 'Saving…' : 'Add to my calendar'}<Icon name="plus" /></button></footer>
    </form>
  </Modal>;
}
function CourseColor({ value, accent, onChange }: { value?: string; accent: string; onChange: (color: string | undefined) => void }) {
  return <div className="field course-color-field"><span>Course color</span><div className="course-color-controls"><input type="color" aria-label="Course color" value={value && /^#[\da-f]{6}$/i.test(value) ? value : accent} onChange={e => onChange(e.target.value)} /><input aria-label="Course color hex" maxLength={7} pattern="#[0-9a-fA-F]{6}" value={value ?? accent} onChange={e => onChange(e.target.value)} /><button type="button" onClick={() => onChange(undefined)} disabled={!value}>Use theme color</button></div></div>;
}
export function EventDialog({ state, event, proposed, commit, onClose, onCourse }: { state: AppState; event: Occurrence; proposed?: { start: string; end: string }; commit: Commit; onClose: () => void; onCourse: () => void }) {
  const session = state.sessions.find(s => s.id === event.sessionId)!;
  const range = sessionRange(session, state.settings.timezone);
  const currentPatch = effectivePatch(session, event.originalDate);
  const [scope, setScope] = useState<'this' | 'all' | 'future'>('this');
  const [form, setForm] = useState({ title: event.title, location: event.location, instructor: event.instructor, notes: event.notes, start: localInput(proposed?.start ?? event.start, state.settings.timezone), end: localInput(proposed?.end ?? event.end, state.settings.timezone), from: range.from, to: range.to, mode: currentPatch.mode ?? 'preserve', teachingOnly: currentPatch.teachingOnly ?? false });
  const [confirm, setConfirm] = useState<'cancel' | 'session' | 'restore' | null>(null), [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const set = (k: string, v: string | boolean) => setForm({ ...form, [k]: v });
  function changeScope(value: typeof scope) {
    const underlying = underlyingSessionOccurrence(state, event);
    if (underlying) {
      const previous = scope === 'this' ? event : underlying, next = value === 'this' ? event : underlying;
      setForm(f => {
        const updated = { ...f };
        if (!proposed && f.start === localInput(previous.start, state.settings.timezone) && f.end === localInput(previous.end, state.settings.timezone)) {
          updated.start = localInput(next.start, state.settings.timezone); updated.end = localInput(next.end, state.settings.timezone);
        }
        for (const key of ['title', 'location', 'instructor', 'notes'] as const) if (f[key] === previous[key]) updated[key] = next[key];
        return updated;
      });
    }
    setScope(value);
  }
  async function save(next: AppState, reason: string) { setSaving(true); try { await commit(next, reason); onClose(); } catch (e) { setError(message(e)); } finally { setSaving(false); } }
  async function apply() {
    try {
      const start = wallTime(form.start.slice(0, 10), form.start.slice(11, 16), state.settings.timezone), end = wallTime(form.end.slice(0, 10), form.end.slice(11, 16), state.settings.timezone);
      if (date(end).toMillis() <= date(start).toMillis()) throw new Error('The end must be after the start.');
      const values = { title: form.title.trim(), location: form.location, instructor: form.instructor, notes: form.notes };
      if (!values.title) throw new Error('A title is required.');
      const underlying = scope === 'this' ? event : underlyingSessionOccurrence(state, event) ?? event;
      const meta: Partial<typeof values> = {};
      for (const key of ['title', 'location', 'instructor', 'notes'] as const) if (values[key] !== underlying[key]) meta[key] = values[key];
      const timingChanged = date(start).toMillis() !== date(underlying.start).toMillis() || date(end).toMillis() !== date(underlying.end).toMillis();
      if (event.extra) { const next = structuredClone(state); Object.assign(next.extras.find(e => e.id === event.id)!, { ...values, start, end }); await save(next, 'Edit extra occurrence'); }
      else if (scope === 'this') {
        if (!timingChanged && !Object.keys(meta).length) { onClose(); return; }
        await save(setException(state, event, { ...meta, ...(timingChanged ? { start, end } : {}), cancelled: false }), 'Edit one occurrence');
      } else {
        const timing = timingChanged ? { weekday: date(start, state.settings.timezone).weekday, startTime: form.start.slice(11, 16), endTime: form.end.slice(11, 16) } : {};
        await save(updateSeries(state, session.id, { ...meta, ...timing, mode: form.mode, teachingOnly: form.teachingOnly }, scope === 'future' ? monday(event.originalDate) : form.from, form.to), scope === 'future' ? 'Edit this and future weeks' : 'Edit all weeks');
      }
    } catch (e) { setError(message(e)); }
  }
  async function addExtra() {
    try {
      const start = wallTime(form.start.slice(0, 10), form.start.slice(11, 16), state.settings.timezone), end = wallTime(form.end.slice(0, 10), form.end.slice(11, 16), state.settings.timezone);
      if (date(end).toMillis() <= date(start).toMillis()) throw new Error('The extra occurrence must end after it starts.');
      const next = structuredClone(state);
      next.extras.push({ id: uid(), sessionId: event.sessionId, title: form.title, location: form.location, instructor: form.instructor, notes: form.notes, start, end, allDay: event.allDay });
      await save(next, 'Add extra occurrence');
    } catch (e) { setError(message(e)); }
  }
  return <Modal title={event.title} subtitle={event.extra ? 'EXTRA OCCURRENCE' : 'EDIT SESSION'} onClose={onClose}>
    <div className="modal-body">
      <div className="event-context"><span className="badge">{date(event.start, state.settings.timezone).toFormat('ccc, d MMM yyyy')}</span><button className="text-button" onClick={onCourse}>Manage course <Icon name="arrow" size={12} /></button></div>
      {!event.extra && <><p className="field-caption">Apply changes to</p><div className="scope-control" role="group" aria-label="Edit scope">{[['this', 'This occurrence'], ['all', 'All weeks'], ['future', 'This & future']].map(([value, label]) => <button key={value} className={scope === value ? 'active' : ''} aria-pressed={scope === value} onClick={() => changeScope(value as typeof scope)}>{label}</button>)}</div></>}
      <Field label="Title"><input value={form.title} onChange={e => set('title', e.target.value)} /></Field>
      <div className="form-row"><Field label={scope === 'this' ? 'Start date & time' : 'Weekly day & start time'}><input type="datetime-local" value={form.start} onChange={e => set('start', e.target.value)} /></Field><Field label="End date & time"><input type="datetime-local" value={form.end} onChange={e => set('end', e.target.value)} /></Field></div>
      {scope !== 'this' && <>
        <div className="form-row"><Field label="Active from"><input type="date" disabled={scope === 'future'} value={scope === 'future' ? monday(event.originalDate) : form.from} onChange={e => set('from', e.target.value)} /></Field><Field label="Active through (inclusive)"><input type="date" value={form.to} onChange={e => set('to', e.target.value)} /></Field></div>
        <Field label="Which weeks?"><select value={form.mode} onChange={e => set('mode', e.target.value)}><option value="preserve">Keep the imported occurrence weeks</option><option value="weekly">Repeat every eligible week in this range</option></select></Field>
        {form.mode === 'weekly' && <Toggle label="Constrain additional weeks to teaching dates" checked={form.teachingOnly} onChange={v => set('teachingOnly', v)} />}
        <p className="hint">Moves use Monday-based weeks. Explicit individual edits and cancellations stay in place.</p>
      </>}
      <div className="form-row"><Field label="Location"><input value={form.location} onChange={e => set('location', e.target.value)} /></Field><Field label="Instructor"><input value={form.instructor} onChange={e => set('instructor', e.target.value)} /></Field></div>
      <Field label="Notes"><textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} /></Field>
      <div className="original-info"><span className="eyebrow">IMPORTED / ORIGINAL POSITION</span><p>{date(event.baselineStart, state.settings.timezone).toFormat('ccc, d MMM · HH:mm')} – {date(event.baselineEnd, state.settings.timezone).toFormat('HH:mm')}</p>{!event.extra && <div className="inline-actions"><button className="text-button" onClick={() => save(restoreOccurrence(state, event.id), 'Clear occurrence exception')}>Clear this exception</button><button className="text-button" onClick={() => save(setException(state, event, { original: true, start: event.baselineStart, end: event.baselineEnd, title: undefined, location: undefined, instructor: undefined, notes: undefined, cancelled: false }), 'Restore original occurrence')}>Use original for this date</button></div>}</div>
      {!confirm && <div className="inline-actions danger-actions"><button className="text-button" onClick={() => setConfirm('cancel')}>{event.extra ? 'Remove extra occurrence' : 'Cancel this occurrence'}</button>{!event.extra && <><button className="text-button" onClick={() => setConfirm('session')}>Remove session</button><button className="text-button" onClick={() => setConfirm('restore')}>Reset whole session</button><button className="text-button" onClick={addExtra}>Add extra at these times</button></> }</div>}
      {confirm && <div className="confirmation"><p>{confirm === 'cancel' ? 'Cancel only this occurrence? You can restore it in the course panel.' : confirm === 'session' ? 'Remove every occurrence of this session? Other sessions stay in your calendar. Recover it in Settings → Recovery.' : 'Restore this entire session to the latest imported schedule? This clears every session edit, individual exception, and extra occurrence.'}</p><div className="inline-actions"><button onClick={() => setConfirm(null)}>Keep editing</button><button className="danger" disabled={saving} onClick={() => {
        if (confirm === 'restore') save(restoreSession(state, session.id), 'Restore original session');
        else if (confirm === 'session') { const next = structuredClone(state); next.sessions.find(s => s.id === session.id)!.deleted = true; save(next, 'Remove session'); }
        else if (event.extra) { const next = structuredClone(state); next.extras = next.extras.filter(e => e.id !== event.id); save(next, 'Remove extra occurrence'); }
        else save(setException(state, event, { cancelled: true }), 'Cancel occurrence');
      }}>Confirm</button></div></div>}
      <ErrorText error={error} />
    </div>
    <footer className="modal-footer"><button onClick={onClose}>Close</button><button className="primary" disabled={saving || !!confirm} onClick={apply}>{saving ? 'Saving…' : 'Save changes'}<Icon name="check" /></button></footer>
  </Modal>;
}
export function CourseDialog({ state, course, commit, onClose, onAddSession }: { state: AppState; course: Course; commit: Commit; onClose: () => void; onAddSession: () => void }) {
  const [form, setForm] = useState(course), [groupName, setGroupName] = useState(courseName(course.name, state.settings.types)), [selectedCourses, setSelectedCourses] = useState<string[]>([]), [sessionTarget, setSessionTarget] = useState(''), [error, setError] = useState(''), [confirm, setConfirm] = useState(false), [saving, setSaving] = useState(false);
  const sessions = state.sessions.filter(s => s.courseId === course.id);
  const exceptions = Object.entries(state.exceptions).filter(([, e]) => sessions.some(s => s.id === e.sessionId));
  const set = (k: string, v: string | boolean) => setForm({ ...form, [k]: v });
  async function save(next: AppState, reason: string, close = true) { setSaving(true); try { await commit(next, reason); if (close) onClose(); } catch (e) { setError(message(e)); } finally { setSaving(false); } }
  return <Modal title="Course details" subtitle="YOUR COURSES" onClose={onClose}>
    <div className="modal-body">
      <Field label="Name"><input required value={form.name} onChange={e => set('name', e.target.value)} /></Field>
      <div className="form-row"><Field label="Short label"><input value={form.label} onChange={e => set('label', e.target.value)} /></Field><Field label="Type"><select value={form.type} onChange={e => set('type', e.target.value)}>{[...new Set([...state.settings.types, form.type])].map(t => <option key={t}>{t}</option>)}</select></Field></div>
      <CourseColor value={form.color} accent={state.settings.accent} onChange={color => setForm({ ...form, color })} />
      {sessions.length > 1 && <div className="group-courses"><p className="hint">Matching course names group automatically. Ungroup separates {courseTypes(state, course).length > 1 ? 'each session type' : 'each session'} into its own course and keeps them separate on reimport.</p><button disabled={saving} onClick={() => { try { const next = structuredClone(state); next.courses = next.courses.map(c => c.id === course.id ? form : c); save(ungroupCourse(next, course.id), 'Ungroup course'); } catch (e) { setError(message(e)); } }}>Ungroup course</button></div>}
      <details className="group-courses"><summary>Group lectures, labs & tutorials</summary><p className="hint">Choose the courses to bring under one name and color. Every session keeps its type, schedule, and individual edits.</p><Field label="Group name"><input value={groupName} onChange={e => setGroupName(e.target.value)} /></Field><div className="group-course-options">{state.courses.filter(c => c.id !== course.id && !c.deleted).map(c => <label key={c.id}><input type="checkbox" checked={selectedCourses.includes(c.id)} onChange={e => setSelectedCourses(e.target.checked ? [...selectedCourses, c.id] : selectedCourses.filter(id => id !== c.id))} /><span>{c.name}<small>{c.type}</small></span></label>)}</div><button disabled={saving || !selectedCourses.length || !groupName.trim()} onClick={() => { try { const next = structuredClone(state); next.courses = next.courses.map(c => c.id === course.id ? { ...form, name: groupName.trim() } : c); save(groupCourses(next, course.id, selectedCourses), 'Group courses'); } catch (e) { setError(message(e)); } }}>Group selected courses</button></details>
      <div className="form-row"><Field label="Default location"><input value={form.location} placeholder="Use imported locations" onChange={e => set('location', e.target.value)} /></Field><Field label="Default instructor"><input value={form.instructor} placeholder="Use imported instructors" onChange={e => set('instructor', e.target.value)} /></Field></div>
      <Field label="Course notes"><textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} /></Field>
      <Toggle label="Visible in my calendar" checked={form.visible} onChange={v => set('visible', v)} />
      <div className="inline-actions"><button disabled={saving || state.courses.findIndex(c => c.id === course.id) === 0} onClick={() => { const next = structuredClone(state), i = next.courses.findIndex(c => c.id === course.id); [next.courses[i - 1], next.courses[i]] = [next.courses[i], next.courses[i - 1]]; save(next, 'Reorder courses'); }}>Move up</button><button disabled={saving || state.courses.findIndex(c => c.id === course.id) === state.courses.length - 1} onClick={() => { const next = structuredClone(state), i = next.courses.findIndex(c => c.id === course.id); [next.courses[i + 1], next.courses[i]] = [next.courses[i], next.courses[i + 1]]; save(next, 'Reorder courses'); }}>Move down</button></div>
      <div className="section-label"><span>SESSIONS · {sessions.length}</span><button className="text-button" onClick={onAddSession}>Add session +</button></div>
      <Field label="Move a session into"><select value={sessionTarget} onChange={e => setSessionTarget(e.target.value)}><option value="">Choose a destination course…</option>{state.courses.filter(c => c.id !== course.id && !c.deleted).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      {sessions.map((s, i) => <div className="list-row" key={s.id}><span>{sessionType(s, course)} · Session {i + 1}<small>{sessionWeekdays(s, state.settings.timezone).map(d => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d - 1]).join(', ')}{s.deleted ? ' · removed' : s.removed ? ' · removed by source' : ''}</small></span><div className="inline-actions"><select aria-label={`Session ${i + 1} type`} value={sessionType(s, course)} onChange={e => { const next = structuredClone(state); next.sessions.find(v => v.id === s.id)!.type = e.target.value; save(next, 'Change session type'); }}>{[...new Set([...state.settings.types, sessionType(s, course)])].map(t => <option key={t}>{t}</option>)}</select>{sessionTarget && <button disabled={saving} onClick={() => { try { save(moveSession(state, s.id, sessionTarget), 'Move session to course'); } catch (e) { setError(message(e)); } }}>Move</button>}<button disabled={saving || sessions.length < 2} onClick={() => { try { const next = structuredClone(state); next.courses = next.courses.map(c => c.id === course.id ? form : c); save(separateSession(next, s.id), 'Separate session'); } catch (e) { setError(message(e)); } }}>Separate</button></div></div>)}
      {sessions.filter(s => sessionWeekdays(s, state.settings.timezone).length > 1).map((s, i) => <Field key={s.id} label={`Separate a weekday from session ${sessions.indexOf(s) + 1}`} hint="The selected weekday becomes independently editable. Its existing exceptions and source identity are retained."><select value="" onChange={e => { if (!e.target.value) return; try { save(separateWeekday(state, s.id, Number(e.target.value)), 'Separate weekday session'); } catch (e) { setError(message(e)); } }}><option value="">Choose a weekday to separate…</option>{sessionWeekdays(s, state.settings.timezone).map(d => <option key={d} value={d}>{['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][d - 1]}</option>)}</select></Field>)}
      {!!exceptions.length && <><div className="section-label">INDIVIDUAL EXCEPTIONS</div>{exceptions.map(([key, ex]) => <div className="list-row" key={key}><span>{date(ex.originalDate).toFormat('d MMM yyyy')}<small>{ex.cancelled ? 'Cancelled' : ex.original ? 'Original schedule' : 'Edited occurrence'}</small></span><button disabled={saving} onClick={() => save(restoreOccurrence(state, key), 'Restore occurrence', false)}>Restore</button></div>)}</>}
      {!confirm ? <button className="text-button danger-actions" onClick={() => setConfirm(true)}>Remove course and all its sessions</button> : <div className="confirmation"><p>Remove this course? Its sessions and exceptions are retained for recovery and stay removed on reimport.</p><div className="inline-actions"><button onClick={() => setConfirm(false)}>Keep course</button><button className="danger" disabled={saving} onClick={() => { const next = structuredClone(state); next.courses.find(c => c.id === course.id)!.deleted = true; save(next, 'Remove course'); }}>Remove course</button></div></div>}
      <ErrorText error={error} />
    </div>
    <footer className="modal-footer"><button onClick={onClose}>Close</button><button className="primary" disabled={saving || !form.name.trim()} onClick={() => { const next = structuredClone(state); next.courses = next.courses.map(c => c.id === course.id ? form : c); save(next, 'Edit course'); }}>Save course <Icon name="check" /></button></footer>
  </Modal>;
}
