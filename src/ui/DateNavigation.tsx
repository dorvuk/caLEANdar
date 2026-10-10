import { useEffect, useRef, useState } from 'react';
import { date, today } from '../core/dates';
import type { View } from '../core/model';
import MiniCalendar from './MiniCalendar';
import { Icon } from './shared';

export default function DateNavigation({ selected, timezone, firstDay, view, onSelect, onPrevious, onNext }: {
  selected: string; timezone: string; firstDay: number; view: View;
  onSelect: (day: string) => void; onPrevious: () => void; onNext: () => void;
}) {
  const [open, setOpen] = useState(false), root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const period = view === 'timeGridWeek' ? 'week' : view === 'dayGridMonth' ? 'month' : 'day';
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key); };
  }, [open]);
  const choose = (day: string) => { onSelect(day); setOpen(false); trigger.current?.focus(); };
  return <div className="navigation-controls" ref={root}>
    <div className="period-navigation" role="group" aria-label={`Navigate by ${period}`}>
      <button aria-label={`Previous ${period}`} title={`Previous ${period}`} onClick={onPrevious}><Icon name="left" size={14} /></button>
      <button onClick={() => choose(today(timezone))}>Today</button>
      <button aria-label={`Next ${period}`} title={`Next ${period}`} onClick={onNext}><Icon name="right" size={14} /></button>
    </div>
    <button ref={trigger} className="date-trigger" aria-label="Jump to date" aria-expanded={open} aria-controls="date-picker" onClick={() => setOpen(!open)}><Icon name="calendar" size={14} /><span>{date(selected).toFormat('d MMM yyyy')}</span></button>
    {open && <div id="date-picker" className="date-popover" role="dialog" aria-label="Choose a date">
      <MiniCalendar selected={selected} onSelect={choose} today={today(timezone)} firstDay={firstDay} />
      <label className="date-entry"><span>Go to date</span><input type="date" aria-label="Jump to date" value={selected} onChange={e => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value) && date(e.target.value).isValid) choose(e.target.value); }} /></label>
    </div>}
  </div>;
}
