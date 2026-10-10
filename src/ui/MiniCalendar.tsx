import { useState } from 'react';
import { date, addDays } from '../core/dates';
import { Icon } from './shared';

export default function MiniCalendar({ selected, onSelect, today, firstDay = 1 }: { selected: string; onSelect: (day: string) => void; today: string; firstDay?: number }) {
  const [offset, setOffset] = useState(0);
  const month = date(selected).startOf('month').plus({ months: offset });
  const startOfWeek = (day: string) => addDays(day, -((date(day).weekday % 7 - firstDay + 7) % 7));
  const start = startOfWeek(month.toISODate()!);
  return <section className="mini-calendar" aria-label="Date navigation">
    <div className="mini-header"><strong>{month.toFormat('MMMM yyyy')}</strong><div><button className="icon-button" aria-label="Previous month" onClick={() => setOffset(offset - 1)}><Icon name="left" size={13} /></button><button className="icon-button" aria-label="Next month" onClick={() => setOffset(offset + 1)}><Icon name="right" size={13} /></button></div></div>
    <div className="mini-grid">{Array.from({ length: 7 }, (_, i) => ['S', 'M', 'T', 'W', 'T', 'F', 'S'][(firstDay + i) % 7]).map((d, i) => <span className="mini-weekday" key={i}>{d}</span>)}
      {Array.from({ length: 42 }, (_, i) => {
        const day = addDays(start, i), isSelectedWeek = startOfWeek(day) === startOfWeek(selected);
        return <button key={day} title={date(day).toFormat('cccc, d MMMM yyyy')} aria-label={day} aria-current={day === selected ? 'date' : undefined}
          className={`${date(day).month !== month.month ? 'muted' : ''} ${isSelectedWeek ? 'in-week' : ''} ${day === selected ? 'selected' : ''} ${day === today ? 'mini-today' : ''}`}
          onClick={() => { setOffset(0); onSelect(day); }}>{date(day).day}</button>;
      })}
    </div>
  </section>;
}
