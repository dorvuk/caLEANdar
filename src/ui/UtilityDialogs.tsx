import { useEffect, useMemo, useState } from 'react';
import { applyImport, previewImport } from '../core/importer';
import { configurationConflicts, mergeConfig, parseConfig } from '../core/config';
import { exportPng, renderTimetableSvg, type PngOptions } from '../core/png';
import { addDays, date, monday } from '../core/dates';
import { exportConfiguration, getBackupContent, getBackups, saveFile, type Backup } from '../platform/storage';
import { uid, type AppState, type Settings } from '../core/model';
import type { Commit } from './EditDialogs';
import { ErrorText, Field, Icon, Modal, Toggle } from './shared';
const errorMessage = (e: unknown) => e instanceof Error ? e.message : String(e);

export function ImportDialog({ state, file, commit, onClose, onImported }: { state: AppState; file: { name: string; content: string }; commit: Commit; onClose: () => void; onImported: (day: string) => void }) {
  const [sourceId, setSourceId] = useState('__auto__');
  const [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const { preview, parseError } = useMemo(() => { try { return { preview: previewImport(state, file.content, file.name, sourceId === '__auto__' ? undefined : sourceId), parseError: '' }; } catch (e) { return { preview: null, parseError: errorMessage(e) }; } }, [state, file, sourceId]);
  return <Modal title="A timetable, made yours." subtitle="IMPORT PREVIEW" onClose={onClose} wide>
    <div className="modal-body"><div className="file-name"><Icon name="calendar" />{file.name}<span>{(file.content.length / 1024).toFixed(1)} KB</span></div>
      <Field label="Import destination"><select value={sourceId} onChange={e => setSourceId(e.target.value)}><option value="__auto__">Automatically match calendar source</option><option value="__new__">A new calendar source</option>{state.sources.map(s => <option key={s.id} value={s.id}>Update {s.name}</option>)}</select></Field>
      {preview && <><div className="import-stats">{[[preview.added, 'NEW'], [preview.changed, 'UPDATED'], [preview.removed.length, 'REMOVED'], [preview.unchanged, 'UNCHANGED']].map(([n, l]) => <div key={l}><b>{n}</b><span>{l}</span></div>)}</div>
        <p className="hint">{state.sources.some(s => s.id === preview.sourceId) ? `Updating ${state.sources.find(s => s.id === preview.sourceId)?.name}. ` : 'Creating a new calendar source. '}Matching course names group automatically; lecture, lab, tutorial, and other session types stay distinct. Updates match original UIDs and preserve ungrouping, session edits, and individual exceptions. Removed source events disappear from the calendar, while their edits remain available if the source brings them back.</p>
        <div className="preview-list">{preview.groups.map((g, i) => <div className="list-row" key={i}><span>{g.name}<small>{g.baselines.length > 1 ? `${g.baselines.length} individually listed events · grouped by exact weekly slot` : 'Independent calendar session'}</small></span><span className="badge">{g.existingSessionId ? 'MATCHED' : 'NEW SESSION'}</span></div>)}</div>
        {!!preview.differences.length && <details open><summary>Source changes ({preview.differences.length})</summary><div className="preview-list">{preview.differences.map((diff, i) => <div className="source-difference" key={i}><strong>{diff.title}</strong><p><span>WAS</span>{diff.before}</p><p><span>NOW</span>{diff.after}</p></div>)}</div></details>}
        {!!preview.removed.length && <details><summary>Removed source events ({preview.removed.length})</summary><div className="preview-list">{preview.removed.map(id => <p key={id}>{id}</p>)}</div></details>}
        {!!preview.warnings.length && <div className="warning"><strong>Review these details before importing</strong>{preview.warnings.map((w, i) => <p key={i}>{w}</p>)}</div>}
      </>}
      <ErrorText error={error || parseError} />
    </div>
    <footer className="modal-footer"><button onClick={onClose}>Cancel</button><button className="primary" disabled={!preview || saving} onClick={async () => { if (!preview) return; setSaving(true); try { const next = applyImport(state, preview); await commit(next, 'Import timetable'); if (!state.sources.some(s => s.id === preview.sourceId)) { const start = next.sessions.filter(s => s.sourceId === preview.sourceId).flatMap(s => s.baselines.map(b => b.ical.match(/DTSTART[^:]*:(\d{4})(\d{2})(\d{2})/)?.slice(1).join('-') ?? '')).filter(Boolean).sort()[0]; if (start) onImported(start); } onClose(); } catch (e) { setError(errorMessage(e)); } finally { setSaving(false); } }}>{saving ? 'Importing…' : 'Import timetable'}<Icon name="upload" /></button></footer>
  </Modal>;
}
export function ConfigDialog({ state, file, commit, onClose }: { state: AppState; file: { name: string; content: string }; commit: Commit; onClose: () => void }) {
  const [mode, setMode] = useState<'replace' | 'merge'>('replace'), [resolution, setResolution] = useState<'current' | 'incoming'>('current'), [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const { incoming, parseError } = useMemo(() => { try { return { incoming: parseConfig(file.content), parseError: '' }; } catch (e) { return { incoming: null, parseError: errorMessage(e) }; } }, [file]);
  const conflicts = useMemo(() => incoming ? configurationConflicts(state, incoming) : [], [incoming, state]);
  return <Modal title="Bring your calendar along." subtitle="CONFIGURATION IMPORT" onClose={onClose}>
    <div className="modal-body"><div className="file-name"><Icon name="upload" />{file.name}</div>{incoming && <>
      <p>{incoming.courses.filter(c => !c.deleted).length} courses · {incoming.sessions.length} sessions · {Object.keys(incoming.exceptions).length} individual exceptions.</p>
      <Field label="Import mode"><select value={mode} onChange={e => setMode(e.target.value as typeof mode)}><option value="replace">Replace my current configuration</option><option value="merge">Merge with my current configuration</option></select></Field>
      {mode === 'replace' ? <div className="warning"><strong>Your entire calendar and preferences will be replaced.</strong><p>A recoverable snapshot of your current configuration is saved first, in the same transaction. Find it in Settings → Recovery.</p></div> : <>
        <p className="hint">Identical IDs merge without duplication. Independent calendars keep their identities. Records with the same ID and different content require a choice.</p>
        {!!conflicts.length && <><Field label={`${conflicts.length} conflicts: which version should win?`}><select value={resolution} onChange={e => setResolution(e.target.value as typeof resolution)}><option value="current">Keep my current records and preferences</option><option value="incoming">Use records and preferences from the file</option></select></Field><details><summary>View conflicting records</summary><div className="preview-list">{conflicts.map((c, i) => <p key={i}>{c}</p>)}</div></details></>}
      </>}
    </>}<ErrorText error={error || parseError} /></div>
    <footer className="modal-footer"><button onClick={onClose}>Cancel</button><button className="primary" disabled={!incoming || saving} onClick={async () => { if (!incoming) return; setSaving(true); try { await commit(mode === 'replace' ? incoming : mergeConfig(state, incoming, resolution), `${mode === 'replace' ? 'Replace' : 'Merge'} configuration`); onClose(); } catch (e) { setError(errorMessage(e)); } finally { setSaving(false); } }}>{saving ? 'Importing…' : mode === 'replace' ? 'Back up & replace' : 'Merge configuration'}<Icon name="check" /></button></footer>
  </Modal>;
}
export function ExportDialog({ state, selected, onClose }: { state: AppState; selected: string; onClose: () => void }) {
  const [options, setOptions] = useState<PngOptions>({ week: selected, generic: false, weekends: state.settings.weekends, minTime: state.settings.minTime, maxTime: state.settings.maxTime, scale: 2 });
  const [error, setError] = useState(''), [saving, setSaving] = useState(false), [saved, setSaved] = useState(false);
  const preview = useMemo(() => { try { return renderTimetableSvg(state, options); } catch { return null; } }, [state, options]);
  const set = <K extends keyof PngOptions>(k: K, v: PngOptions[K]) => { setOptions({ ...options, [k]: v }); setSaved(false); };
  return <Modal title="Take your week with you." subtitle="EXPORT PNG" onClose={onClose} wide>
    <div className="modal-body export-body"><div>
      <Field label="Export mode"><select value={String(options.generic)} onChange={e => set('generic', e.target.value === 'true')}><option value="false">Selected real calendar week</option><option value="true">Generic weekly timetable</option></select></Field>
      <Field label={options.generic ? 'Pattern at this date' : 'A date in the week'}><input type="date" value={options.week} onChange={e => set('week', e.target.value)} /></Field>
      <div className="form-row"><Field label="From"><input type="time" value={options.minTime} onChange={e => set('minTime', e.target.value)} /></Field><Field label="Through (24:00 allowed)"><input pattern="[0-2][0-9]:[0-5][0-9]" value={options.maxTime} onChange={e => set('maxTime', e.target.value)} /></Field></div>
      <Toggle label="Include weekends" checked={options.weekends} onChange={v => set('weekends', v)} />
      <Field label="Resolution"><select value={options.scale} onChange={e => set('scale', Number(e.target.value))}><option value={1}>1× · compact</option><option value={2}>2× · crisp (recommended)</option><option value={3}>3× · large</option><option value={4}>4× · print</option></select></Field>
      <p className="hint">{options.generic ? 'Shows weekly recurring slots. One-off events, nonweekly rules, and individual week exceptions are excluded. Frequency gaps are not shown; sessions with different patterns use the pattern at the selected date.' : `Includes your exact individual edits for ${date(monday(options.week)).toFormat('d MMM')}–${date(addDays(monday(options.week), 6)).toFormat('d MMM yyyy')}.`}</p>
      <p className="hint">The image shows only the selected hours. Overnight sessions are split across day columns.</p>
      {preview && <small className="hint">{preview.width * options.scale} × {preview.height * options.scale} px · standard PNG</small>}
      <ErrorText error={error} />{saved && <p className="success" role="status">PNG saved.</p>}
    </div><div className="png-preview">{preview ? <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(preview.svg)}`} alt="Preview of exported weekly timetable" /> : <p>Choose a valid date and time range.</p>}</div></div>
    <footer className="modal-footer"><button onClick={onClose}>Close</button><button className="primary" disabled={saving || !preview} onClick={async () => { setSaving(true); setError(''); try { const png = await exportPng(state, options); const saved = await saveFile(options.generic ? 'caleandar-regular-week.png' : `caleandar-week-${monday(options.week)}.png`, png, 'png'); setSaved(saved); } catch (e) { setError(errorMessage(e)); } finally { setSaving(false); } }}>{saving ? 'Rendering…' : 'Save PNG'}<Icon name="download" /></button></footer>
  </Modal>;
}
export function SettingsDialog({ state, commit, onClose, onImportConfig, initialTab = 'appearance' }: { state: AppState; commit: Commit; onClose: () => void; onImportConfig: () => void; initialTab?: string }) {
  const [tab, setTab] = useState(initialTab), [settings, setSettings] = useState(structuredClone(state.settings)), [academics, setAcademics] = useState(structuredClone(state.academics));
  const [typesText, setTypesText] = useState(state.settings.types.join(', '));
  const [error, setError] = useState(''), [saving, setSaving] = useState(false), [backups, setBackups] = useState<Backup[]>([]), [selectedBackup, setSelectedBackup] = useState<Backup | null>(null), [notice, setNotice] = useState('');
  useEffect(() => { if (tab === 'recovery') getBackups().then(setBackups).catch(e => setError(errorMessage(e))); }, [tab]);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings({ ...settings, [k]: v });
  const year = academics.find(y => y.id === settings.academicYearId)!;
  const setYear = (value: typeof year) => setAcademics(academics.map(y => y.id === year.id ? value : y));
  async function save(next: AppState, reason: string) { setSaving(true); setError(''); try { await commit(next, reason); onClose(); } catch (e) { setError(errorMessage(e)); } finally { setSaving(false); } }
  return <Modal title="Just the way you like it." subtitle="SETTINGS" onClose={onClose} wide>
    <div className="settings-tabs" role="tablist" aria-label="Settings categories">{['appearance', 'calendar', 'academic', 'recovery'].map(t => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}</div>
    <div className="modal-body settings-body" role="tabpanel">
      {tab === 'appearance' && <>
        <div className="form-row"><Field label="Primary accent"><div className="color-field"><input type="color" value={settings.accent} onChange={e => set('accent', e.target.value)} /><input aria-label="Accent hex value" value={settings.accent} onChange={e => set('accent', e.target.value)} maxLength={7} /></div></Field><Field label="Appearance"><select value={settings.theme} onChange={e => set('theme', e.target.value as Settings['theme'])}><option value="light">Paper · light</option><option value="dark">After hours · dark</option></select></Field></div>
        <div className="form-row"><Field label="Interface text size"><input type="number" min={10} max={24} value={settings.fontSize} onChange={e => set('fontSize', Number(e.target.value))} /></Field><Field label="Event text size"><input type="number" min={10} max={24} value={settings.eventFontSize} onChange={e => set('eventFontSize', Number(e.target.value))} /></Field></div>
        <div className="form-row"><Field label="Font"><select value={settings.font} onChange={e => set('font', e.target.value as Settings['font'])}><option value="mono">Minecraft · pixel font</option><option value="system">System</option></select></Field><Field label="Density"><select value={settings.density} onChange={e => set('density', e.target.value as Settings['density'])}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></Field></div>
        <div className="section-label">INSIDE EVENT BLOCKS</div>
        <div className="toggle-grid">{[['short', 'Use short course labels'], ['time', 'Time range'], ['location', 'Location'], ['type', 'Course type'], ['instructor', 'Instructor']].map(([key, label]) => <Toggle key={key} label={label} checked={settings.labels[key as keyof typeof settings.labels] as boolean} onChange={v => set('labels', { ...settings.labels, [key]: v })} />)}</div>
        <Field label="Custom label on every block"><input value={settings.labels.custom} onChange={e => set('labels', { ...settings.labels, custom: e.target.value })} placeholder="Optional" /></Field>
      </>}
      {tab === 'calendar' && <>
        <div className="form-row"><Field label="Default view"><select value={settings.view} onChange={e => set('view', e.target.value as Settings['view'])}><option value="timeGridWeek">Week</option><option value="dayGridMonth">Month</option><option value="timeGridDay">Day</option></select></Field><Field label="First visible weekday"><select value={settings.firstDay} onChange={e => set('firstDay', Number(e.target.value))}>{['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => <option key={d} value={i}>{d}</option>)}</select></Field></div>
        <div className="form-row"><Field label="Visible hours from"><input type="time" value={settings.minTime} onChange={e => set('minTime', e.target.value)} /></Field><Field label="Visible hours through (24:00 allowed)"><input value={settings.maxTime} onChange={e => set('maxTime', e.target.value)} /></Field></div>
        <Field label="Calendar timezone" hint="Floating times and recurring edits use this zone. Changing it reinterprets their wall times. Zoned imports and explicit occurrence times keep their instants."><input value={settings.timezone} onChange={e => set('timezone', e.target.value)} /></Field>
        <div className="toggle-grid"><Toggle label="Show weekends" checked={settings.weekends} onChange={v => set('weekends', v)} /><Toggle label="12-hour time" checked={settings.hour12} onChange={v => set('hour12', v)} /><Toggle label="ISO week numbers" checked={settings.weekNumbers} onChange={v => set('weekNumbers', v)} /><Toggle label="Academic overlays" checked={settings.academicOverlay} onChange={v => set('academicOverlay', v)} /><Toggle label="Highlight Slovenian days off" checked={settings.publicHolidays} onChange={v => set('publicHolidays', v)} /></div>
        <p className="hint">Holidays and academic overlays are visual guides. They do not cancel imported or existing classes. Recurring edits always use Monday-based weeks.</p>
        <Field label="Course types" hint="Separate type names with commas."><input value={typesText} onChange={e => setTypesText(e.target.value)} /></Field>
      </>}
      {tab === 'academic' && <>
        <div className="form-row"><Field label="Selected academic year"><select value={settings.academicYearId} onChange={e => set('academicYearId', e.target.value)}>{academics.map(y => <option key={y.id} value={y.id}>{y.name}</option>)}</select></Field><button className="align-end" onClick={() => { const id = uid(); setAcademics([...academics, { id, name: 'My academic year', periods: [], breaks: [] }]); set('academicYearId', id); }}>New year <Icon name="plus" /></button></div>
        <Field label="Year name"><input value={year.name} onChange={e => setYear({ ...year, name: e.target.value })} /></Field>
        <div className="section-label">PERIODS · INCLUSIVE DATES</div>
        {year.periods.map(p => <div className="academic-row" key={p.id}><input aria-label="Period name" value={p.name} onChange={e => setYear({ ...year, periods: year.periods.map(v => v.id === p.id ? { ...v, name: e.target.value } : v) })} /><select aria-label="Period kind" value={p.kind} onChange={e => setYear({ ...year, periods: year.periods.map(v => v.id === p.id ? { ...v, kind: e.target.value as 'teaching' | 'exam' } : v) })}><option value="teaching">Teaching</option><option value="exam">Exam</option></select><input aria-label="Period start" type="date" value={p.start} onChange={e => setYear({ ...year, periods: year.periods.map(v => v.id === p.id ? { ...v, start: e.target.value } : v) })} /><input aria-label="Period end" type="date" value={p.end} onChange={e => setYear({ ...year, periods: year.periods.map(v => v.id === p.id ? { ...v, end: e.target.value } : v) })} /><button className="icon-button" aria-label={`Remove ${p.name}`} onClick={() => setYear({ ...year, periods: year.periods.filter(v => v.id !== p.id) })}><Icon name="close" /></button></div>)}
        <button onClick={() => setYear({ ...year, periods: [...year.periods, { id: uid(), name: 'Teaching period', start: '2026-10-01', end: '2027-01-15', kind: 'teaching' }] })}>Add period +</button>
        <div className="section-label">NON-TEACHING DAYS & BREAKS</div>
        {year.breaks.map(b => <div className="academic-row break-row" key={b.id}><input aria-label="Break name" value={b.name} onChange={e => setYear({ ...year, breaks: year.breaks.map(v => v.id === b.id ? { ...v, name: e.target.value } : v) })} /><input aria-label="Break start" type="date" value={b.start} onChange={e => setYear({ ...year, breaks: year.breaks.map(v => v.id === b.id ? { ...v, start: e.target.value } : v) })} /><input aria-label="Break end" type="date" value={b.end} onChange={e => setYear({ ...year, breaks: year.breaks.map(v => v.id === b.id ? { ...v, end: e.target.value } : v) })} /><button className="icon-button" aria-label={`Remove ${b.name}`} onClick={() => setYear({ ...year, breaks: year.breaks.filter(v => v.id !== b.id) })}><Icon name="close" /></button></div>)}
        <button onClick={() => setYear({ ...year, breaks: [...year.breaks, { id: uid(), name: 'Academic break', start: '2026-12-25', end: '2027-01-01' }] })}>Add break +</button>
        <p className="hint">The initial FRI 2026/27 preset follows the official study calendar. New academic years start empty; enter verified dates. Academic week 1 is the Monday-based week containing the first teaching day.</p>
      </>}
      {tab === 'recovery' && <>
        <div className="section-label">MOVE BETWEEN DEVICES</div><div className="inline-actions"><button onClick={async () => { try { if (await exportConfiguration(state)) setNotice('Configuration saved.'); } catch (e) { setError(errorMessage(e)); } }}>Export configuration <Icon name="download" /></button><button onClick={onImportConfig}>Import configuration <Icon name="upload" /></button></div>
        <p className="hint">A versioned JSON file includes original imports, every edit, academic dates, and preferences. Transfer it manually to your other computer.</p>
        <div className="section-label">REMOVED COURSES & SESSIONS</div>
        {state.courses.filter(c => c.deleted).map(c => <div className="list-row" key={c.id}><span>{c.name}</span><button disabled={saving} onClick={() => { const next = structuredClone(state); next.courses.find(v => v.id === c.id)!.deleted = false; save(next, 'Recover course'); }}>Recover</button></div>)}
        {state.sessions.filter(s => s.deleted).map(s => <div className="list-row" key={s.id}><span>{state.courses.find(c => c.id === s.courseId)?.name}<small>Removed session</small></span><button disabled={saving} onClick={() => { const next = structuredClone(state); next.sessions.find(v => v.id === s.id)!.deleted = false; save(next, 'Recover session'); }}>Recover</button></div>)}
        {!state.courses.some(c => c.deleted) && !state.sessions.some(s => s.deleted) && <p className="hint">No removed items.</p>}
        <div className="section-label">RECOVERABLE SNAPSHOTS</div>
        <p className="hint">Every saved change retains the preceding state. Desktop keeps the last 50 snapshots; browser preview keeps 5.</p>
        <div className="preview-list">{backups.map(b => <div className="list-row" key={b.id}><span>{b.reason}<small>{date(b.createdAt, state.settings.timezone).toFormat('d MMM yyyy · HH:mm:ss')}</small></span><button onClick={() => setSelectedBackup(b)}>Restore…</button></div>)}</div>
        {selectedBackup && <div className="confirmation"><p>Replace your complete configuration with the state before “{selectedBackup.reason}”? The current state is backed up first.</p><div className="inline-actions"><button onClick={() => setSelectedBackup(null)}>Cancel</button><button className="danger" disabled={saving} onClick={async () => { try { const content = await getBackupContent(selectedBackup.id); await save(parseConfig(content), 'Restore backup'); } catch (e) { setError(errorMessage(e)); } }}>Back up & restore</button></div></div>}
        {!backups.length && <p className="hint">Snapshots appear after your first saved change.</p>}
      </>}
      <ErrorText error={error} />{notice && <p className="success" role="status">{notice}</p>}
    </div>
    <footer className="modal-footer"><button onClick={onClose}>Close</button><button className="primary" disabled={saving} onClick={() => save({ ...state, settings: { ...settings, types: [...new Set(typesText.split(',').map(t => t.trim()).filter(Boolean))] }, academics }, 'Update settings')}>Save settings <Icon name="check" /></button></footer>
  </Modal>;
}
