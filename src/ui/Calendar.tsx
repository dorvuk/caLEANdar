import { useMemo, type RefObject } from 'react';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import luxonPlugin from '@fullcalendar/luxon3';
import type { DatesSetArg, EventContentArg, EventInput } from '@fullcalendar/core';
import { expandCalendar } from '../core/engine';
import { academicInfo, addDays, date, slovenianHoliday, today } from '../core/dates';
import { eventLabels } from '../core/labels';
import type { AppState, Occurrence } from '../core/model';

export default function Calendar({ state, range, calendarRef, onDates, onEvent, onCreate, onMove }: {
  state: AppState; range: { start: string; end: string }; calendarRef: RefObject<FullCalendar | null>;
  onDates: (arg: DatesSetArg) => void; onEvent: (event: Occurrence) => void;
  onCreate: (day: string, time?: string) => void; onMove: (event: Occurrence, start: string, end: string) => void;
}) {
  const settings = state.settings;
  const year = state.academics.find(y => y.id === settings.academicYearId);
  const { events, error } = useMemo(() => {
    try { return { events: expandCalendar(state, range.start, range.end), error: '' }; }
    catch (e) { return { events: [], error: e instanceof Error ? e.message : String(e) }; }
  }, [state, range.start, range.end]);
  const calendarEvents = useMemo((): EventInput[] => {
    const all: EventInput[] = events.map(e => ({ id: e.id, title: e.title, start: e.start, end: e.end, allDay: e.allDay, extendedProps: { occurrence: e }, classNames: [e.modified ? 'event-modified' : ''] }));
    if (settings.academicOverlay && year) {
      for (const p of year.periods) all.push({ id: `period:${p.id}`, start: p.start, end: addDays(p.end, 1), display: 'background', classNames: [`academic-${p.kind}`] });
      for (const b of year.breaks) all.push({ id: `break:${b.id}`, start: b.start, end: addDays(b.end, 1), display: 'background', classNames: ['academic-break'] });
    }
    return all;
  }, [events, year, settings.academicOverlay]);
  const renderEvent = (arg: EventContentArg) => {
    const occurrence = arg.event.extendedProps.occurrence as Occurrence | undefined;
    if (!occurrence) return null;
    const labels = eventLabels(occurrence, state);
    return <div className="event-labels" title={labels.join('\n')}><strong>{labels[0]}</strong>{labels.slice(1).map((l, i) => <span key={i}>{l}</span>)}{occurrence.modified && <i className="edit-dot" aria-label="Edited occurrence" />}</div>;
  };
  return <div className="calendar-container">
    {error && <p className="error" role="alert">{error}</p>}
    <FullCalendar ref={calendarRef} plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin, luxonPlugin]}
      initialView={settings.view} initialDate={today(settings.timezone)} timeZone={settings.timezone}
      headerToolbar={false} firstDay={settings.firstDay} weekends={settings.weekends} weekNumbers={settings.weekNumbers} weekNumberCalculation="ISO"
      height="100%" expandRows slotMinTime={settings.minTime} slotMaxTime={settings.maxTime} slotDuration="00:30:00"
      scrollTime="08:00:00" allDaySlot nowIndicator dayMaxEvents={4} eventMinHeight={24}
      editable selectable selectMirror eventOverlap slotEventOverlap={false}
      eventTimeFormat={{ hour: 'numeric', minute: '2-digit', hour12: settings.hour12 }}
      slotLabelFormat={{ hour: 'numeric', minute: '2-digit', hour12: settings.hour12 }}
      events={calendarEvents} eventContent={renderEvent} datesSet={onDates}
      eventClick={arg => { if (arg.event.extendedProps.occurrence) onEvent(arg.event.extendedProps.occurrence); }}
      select={arg => { onCreate(arg.startStr.slice(0, 10), arg.allDay ? undefined : date(arg.startStr, settings.timezone).toFormat('HH:mm')); calendarRef.current?.getApi().unselect(); }}
      eventDrop={arg => { const event = arg.event.extendedProps.occurrence as Occurrence; const start = arg.event.startStr, end = arg.event.endStr; arg.revert(); if (event && end) onMove(event, start, end); }}
      eventResize={arg => { const event = arg.event.extendedProps.occurrence as Occurrence; const start = arg.event.startStr, end = arg.event.endStr; arg.revert(); if (event && end) onMove(event, start, end); }}
      dayHeaderContent={arg => {
        const day = date(arg.date.toISOString(), settings.timezone), info = academicInfo(day.toISODate()!, year);
        return <div className="day-heading"><span>{day.toFormat('ccc').toUpperCase()}</span><b>{day.toFormat('dd')}</b>{settings.academicOverlay && (info.pause || info.period?.kind === 'exam') && <small>{info.pause ? 'BREAK' : 'EXAM'}</small>}</div>;
      }}
      dayCellClassNames={arg => {
        const day = date(arg.date.toISOString(), settings.timezone).toISODate()!;
        return settings.publicHolidays && slovenianHoliday(day) ? ['holiday-cell'] : [];
      }}
      dayCellDidMount={arg => {
        const day = date(arg.date.toISOString(), settings.timezone).toISODate()!;
        const holiday = settings.publicHolidays && slovenianHoliday(day); if (holiday) arg.el.title = holiday;
      }}
    />
    {!state.courses.some(c => c.visible && !c.deleted) && <div className="empty-calendar"><div className="empty-pixels">▦</div><h3>A little room for your week.</h3><p>Import your timetable or add your first course.</p><small>Select a time on the calendar to get started.</small></div>}
  </div>;
}
