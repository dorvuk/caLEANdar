import { addDays, date, monday } from './dates';
import { expandCalendar, genericWeek } from './engine';
import { eventLabels } from './labels';
import type { AppState, Occurrence } from './model';
import { courseColors } from './colors';
import pixelFont from '../assets/fonts/Minecraft.otf?url&inline';
import pixelFontBold from '../assets/fonts/Minecraft-Bold.otf?url&inline';
import brandLogo from '../../assets/transp.png?url&inline';

export interface PngOptions { week: string; generic: boolean; weekends: boolean; minTime: string; maxTime: string; scale: number }
export interface Segment { event: Occurrence; day: number; start: number; end: number; lane: number; lanes: number }
const minute = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const xml = (text: string) => text.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!));
export function layoutOverlaps(segments: Segment[]): Segment[] {
  const sorted = segments.map(s => ({ ...s })).sort((a, b) => a.day - b.day || a.start - b.start || b.end - a.end);
  let group: Segment[] = [], laneEnds: number[] = [], groupEnd = -1, day = -1;
  const finish = () => { for (const s of group) s.lanes = laneEnds.length; group = []; laneEnds = []; groupEnd = -1; };
  for (const segment of sorted) {
    if (segment.day !== day || segment.start >= groupEnd) finish();
    day = segment.day;
    let lane = laneEnds.findIndex(end => end <= segment.start); if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = segment.end; segment.lane = lane; group.push(segment); groupEnd = Math.max(groupEnd, segment.end);
  }
  finish(); return sorted;
}
function wrap(text: string, width: number, font: number): string[] {
  const max = Math.max(2, Math.floor(width / (font * .8))), lines: string[] = [];
  for (const word of text.split(/\s+/)) {
    if (lines.length && lines.at(-1)!.length + word.length + 1 <= max) lines[lines.length - 1] += ` ${word}`;
    else { for (let i = 0; i < word.length; i += max) lines.push(word.slice(i, i + max)); }
  }
  return lines;
}
export function renderTimetableSvg(state: AppState, options: PngOptions): { svg: string; width: number; height: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.week) || !date(options.week).isValid) throw new Error('Choose a valid week date.');
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(options.minTime) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(options.maxTime) && options.maxTime !== '24:00') throw new Error('Choose valid hours.');
  const startMinute = minute(options.minTime), endMinute = minute(options.maxTime);
  if (startMinute >= endMinute || options.scale < 1 || options.scale > 4) throw new Error('Choose an ascending time range and a scale from 1 to 4.');
  const first = monday(options.week), days = options.weekends ? 7 : 5;
  const occurrences = options.generic ? genericWeek(state, options.week) : expandCalendar(state, first, addDays(first, 7));
  const width = options.weekends ? 1540 : 1240, left = 76, top = 150, col = (width - left - 24) / days;
  const font = state.settings.eventFontSize, lineHeight = font * 1.4;
  const segments: Segment[] = [];
  for (const e of occurrences.filter(e => !e.allDay)) {
    for (let d = 0; d < days; d++) {
      const day = date(addDays(first, d), state.settings.timezone), next = day.plus({ days: 1 });
      const start = date(e.start, state.settings.timezone), end = date(e.end, state.settings.timezone);
      if (start >= next || end <= day) continue;
      const s = start < day ? 0 : start.hour * 60 + start.minute, en = end >= next ? 1440 : end.hour * 60 + end.minute;
      if (s >= endMinute || en <= startMinute) continue;
      segments.push({ event: e, day: d, start: Math.max(s, startMinute), end: Math.min(en, endMinute), lane: 0, lanes: 1 });
    }
  }
  const laidOut = layoutOverlaps(segments);
  // Increase vertical resolution when short or overlapping classes need more room for labels.
  // The time axis scales with the blocks, preserving accurate positioning without clipping text.
  let px = 1.45;
  for (const s of laidOut) {
    const lines = eventLabels(s.event, state).flatMap(l => wrap(l, col / s.lanes - 26, font)).length;
    px = Math.max(px, (lines * lineHeight + 18) / Math.max(s.end - s.start, 1));
  }
  const allDays = occurrences.filter(e => e.allDay), allDayRows = Math.max(0, ...Array.from({ length: days }, (_, i) => allDays.filter(e => e.start.slice(0, 10) <= addDays(first, i) && e.end.slice(0, 10) > addDays(first, i)).length));
  const allDayHeight = Math.max(32, ...allDays.map(e => eventLabels(e, state).flatMap(l => wrap(l, col - 26, font)).length * lineHeight + 16));
  const gridTop = top + allDayRows * allDayHeight, height = Math.ceil(gridTop + (endMinute - startMinute) * px + 72);
  if (height > 16_000) throw new Error('These labels need a very tall image. Use shorter labels, a smaller event font, or export a narrower time range.');
  const accent = state.settings.accent, text = state.settings.theme === 'dark' ? '#eef2eb' : '#1c2922', bg = state.settings.theme === 'dark' ? '#171e1a' : '#fafbf7';
  const surface = state.settings.theme === 'dark' ? '#252f28' : '#eef2e9', stroke = state.settings.theme === 'dark' ? '#4c5c51' : '#cdd5c8';
  const fontStyle = state.settings.font === 'mono' ? `<style>@font-face { font-family: 'Minecraft'; src: url('${pixelFont}') format('opentype'); font-weight: 400; } @font-face { font-family: 'Minecraft'; src: url('${pixelFontBold}') format('opentype'); font-weight: 700; }</style>` : '';
  const family = state.settings.font === 'mono' ? 'Minecraft, Consolas, monospace' : 'Arial, sans-serif';
  const eventColors = (e: Occurrence) => { const color = state.courses.find(c => c.id === e.courseId)?.color; return color ? courseColors(color, state.settings.theme === 'dark') : { background: surface, border: accent }; };
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${fontStyle}<rect width="100%" height="100%" fill="${bg}"/><g font-family="${family}" fill="${text}">`];
  out.push(`${state.settings.theme === 'dark' ? '<rect x="24" y="16" width="28" height="28" fill="#ffd0d7"/>' : ''}<image x="24" y="16" width="28" height="28" href="${brandLogo}" style="image-rendering:pixelated"/><text x="62" y="38" font-size="18" font-weight="bold">caLEANdar</text>`);
  const heading = options.generic ? 'Your regular week' : `${date(first).toFormat('d MMM')} – ${date(addDays(first, 6)).toFormat('d MMM yyyy')}`;
  out.push(`<text x="24" y="78" font-size="27" font-weight="bold">${xml(heading)}</text>`);
  out.push(`<text x="24" y="105" font-size="12">${xml(options.generic ? 'Regular sessions · one-off events and individual exceptions excluded · pattern at selected date' : `ISO week ${date(first).weekNumber} · ${state.settings.timezone} · personalized schedule`)}</text>`);
  for (let i = 0; i < days; i++) {
    const day = date(addDays(first, i)); const x = left + i * col;
    out.push(`<rect x="${x}" y="122" width="${col}" height="28" fill="${surface}"/><text x="${x + 12}" y="141" font-size="12" font-weight="bold">${xml(options.generic ? day.toFormat('cccc').toUpperCase() : day.toFormat('ccc · dd MMM').toUpperCase())}</text>`);
    out.push(`<path d="M${x} 122V${height - 48}" stroke="${stroke}" fill="none"/>`);
    allDays.filter(e => e.start.slice(0, 10) <= day.toISODate()! && e.end.slice(0, 10) > day.toISODate()!).forEach((e, row) => {
      const y = top + row * allDayHeight + 3;
      const colors = eventColors(e);
      out.push(`<rect x="${x + 4}" y="${y}" width="${col - 8}" height="${allDayHeight - 6}" fill="${colors.background}" stroke="${colors.border}"/>`);
      const labels = eventLabels(e, state).flatMap(l => wrap(l, col - 26, font));
      labels.forEach((label, i) => out.push(`<text x="${x + 10}" y="${y + font + 5 + i * lineHeight}" font-size="${font}">${xml(label)}</text>`));
    });
  }
  for (let m = startMinute; m <= endMinute; m += 30) {
    const y = gridTop + (m - startMinute) * px;
    out.push(`<path d="M${left} ${y}H${width - 24}" stroke="${stroke}" stroke-dasharray="${m % 60 ? '2 4' : 'none'}"/>`);
    if (m % 60 === 0 || m === startMinute) {
      const label = state.settings.hour12 ? date(`2000-01-01T${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`).toFormat('h a') : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      out.push(`<text x="${left - 10}" y="${y + 4}" text-anchor="end" font-size="11">${xml(label)}</text>`);
    }
  }
  for (const [idx, s] of laidOut.entries()) {
    const x = left + s.day * col + s.lane * col / s.lanes + 4, y = gridTop + (s.start - startMinute) * px + 2;
    const w = col / s.lanes - 8, h = Math.max(12, (s.end - s.start) * px - 4);
    out.push(`<defs><clipPath id="clip${idx}"><rect x="${x + 7}" y="${y + 3}" width="${Math.max(1, w - 14)}" height="${Math.max(1, h - 6)}"/></clipPath></defs>`);
    const colors = eventColors(s.event);
    out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${colors.background}" stroke="${colors.border}"/><rect x="${x}" y="${y}" width="3" height="${h}" fill="${colors.border}"/><g clip-path="url(#clip${idx})">`);
    let line = 0;
    for (const [index, label] of eventLabels(s.event, state).entries()) {
      const lines = wrap(label, w - 18, font);
      for (const labelLine of lines) { out.push(`<text x="${x + 9}" y="${y + font + 7 + line * lineHeight}" font-size="${font}" font-weight="${index === 0 ? 'bold' : 'normal'}">${xml(labelLine)}</text>`); line++; }
    }
    out.push('</g>');
  }
  out.push(`<text x="24" y="${height - 20}" font-size="11">${xml(options.generic ? 'Individual weeks can differ. Export a selected week to include exceptions.' : 'A little order. All dates and times follow your calendar settings.')}</text></g></svg>`);
  return { svg: out.join(''), width, height };
}
export async function exportPng(state: AppState, options: PngOptions): Promise<Uint8Array> {
  const { svg, width, height } = renderTimetableSvg(state, options);
  if (width * height * options.scale ** 2 > 60_000_000) throw new Error('The selected resolution is too large. Reduce the export scale.');
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image(); img.src = url; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = width * options.scale; canvas.height = height * options.scale;
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('PNG rendering is unavailable.');
    ctx.scale(options.scale, options.scale); ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('PNG encoding failed.')), 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  } finally { URL.revokeObjectURL(url); }
}
