import { expect, it } from 'vitest';
import { layoutOverlaps, renderTimetableSvg } from '../src/core/png';
import { emptyState, type Occurrence } from '../src/core/model';
import { applyImport, previewImport } from '../src/core/importer';
import { event, recurring, wrap } from './fixtures';
it('positions overlapping events in separate columns and reuses columns for non-overlapping events', () => {
  const event = {} as Occurrence;
  const laidOut = layoutOverlaps([{ event, day: 0, start: 600, end: 720, lane: 0, lanes: 1 }, { event, day: 0, start: 660, end: 780, lane: 0, lanes: 1 }, { event, day: 0, start: 720, end: 800, lane: 0, lanes: 1 }, { event, day: 0, start: 800, end: 900, lane: 0, lanes: 1 }]);
  expect(laidOut.map(e => e.lane)).toEqual([0, 1, 0, 0]); expect(laidOut.map(e => e.lanes)).toEqual([2, 2, 2, 1]);
});
it('gives short classes enough vertical space for all configured labels', () => {
  const source = wrap(event('short', '20261009').replace('T150000', 'T131500').replace('SUMMARY:Course 1', 'SUMMARY:A fairly long course name'));
  const state = applyImport(emptyState(), previewImport(emptyState(), source, 'test.ics'));
  const image = renderTimetableSvg(state, { week: '2026-10-05', generic: false, weekends: false, minTime: '07:00', maxTime: '21:00', scale: 1 });
  expect(image.height).toBeGreaterThan(3000); expect(image.svg).toContain('fairly'); expect(image.svg).toContain('long'); expect(image.svg).toContain('P01');
});
it('produces self-contained SVG with escaped text, real dates, time positioning and labels', () => {
  const state = applyImport(emptyState(), previewImport(emptyState(), recurring, 'test.ics')); state.courses[0].name = 'Math <A & B>';
  const image = renderTimetableSvg(state, { week: '2026-10-05', generic: false, weekends: false, minTime: '07:00', maxTime: '21:00', scale: 2 });
  expect(image.svg).toContain('Math &lt;A &amp; B&gt;'); expect(image.svg).toContain('05 OCT'); expect(image.svg).toContain('13:00'); expect(image.svg).toContain('P01'); expect(image.svg).toContain('y="674"'); expect(image.width).toBe(1240); expect(image.height).toBeGreaterThan(1000);
  expect(image.svg).not.toContain('<script'); expect(image.svg).not.toContain('http://localhost');
});
