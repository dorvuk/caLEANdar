import { expect, it } from 'vitest';
import { applyImport, previewImport } from '../src/core/importer';
import { expandCalendar } from '../src/core/engine';
import { emptyState } from '../src/core/model';
import { addDays, date } from '../src/core/dates';
import { event, wrap } from './fixtures';

it('handles 5,000 individually listed classes and expands only the requested week', () => {
  const records: string[] = [];
  for (let c = 0; c < 100; c++) for (let week = 0; week < 50; week++) {
    const day = date(addDays('2026-10-02', week * 7)).toFormat('yyyyMMdd');
    records.push(event(`course-${c}-week-${week}`, day).replace('SUMMARY:Course 1', `SUMMARY:Course ${c}`));
  }
  const state = applyImport(emptyState(), previewImport(emptyState(), wrap(records.join('\r\n')), 'large.ics'));
  expect(state.sessions).toHaveLength(100);
  const started = performance.now();
  const events = expandCalendar(state, '2026-10-05', '2026-10-12');
  const elapsed = performance.now() - started;
  expect(events).toHaveLength(100);
  console.log(`5,000 source events: one-week expansion ${elapsed.toFixed(0)} ms`);
  expect(elapsed).toBeLessThan(3000);
}, 15_000);
