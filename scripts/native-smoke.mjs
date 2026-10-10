import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

// Attach to a hidden validation build, never to the user's production database.
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const context = browser.contexts()[0];
const page = context.pages()[0] ?? await context.newPage();
await page.waitForSelector('.app');
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  return ['tauri.localhost', 'ipc.localhost', '127.0.0.1', 'localhost'].includes(url.hostname) || !url.protocol.startsWith('http') ? route.continue() : route.abort();
});
const errors = []; page.on('pageerror', e => errors.push(e.message));
const imported = JSON.parse(await readFile('test-results/configuration.json', 'utf8'));
// Exercise the upgrade from an older calendar whose matching types were separate courses.
const oldLecture = imported.courses.find(c => c.name === 'Algorithms' && !c.deleted);
const oldLab = imported.courses.find(c => c.importedName === 'Algorithms — Laboratory');
oldLecture.name = oldLecture.importedName; delete oldLecture.grouped; delete oldLecture.autoGroup;
oldLab.deleted = false;
for (const session of imported.sessions.filter(s => s.courseId === oldLecture.id)) {
  if (session.type === 'Laboratory') session.courseId = oldLab.id;
  delete session.type;
}
const result = await page.evaluate(async content => {
  const invoke = window.__TAURI_INTERNALS__.invoke;
  const before = await invoke('load_state');
  const revision = await invoke('save_state', { content, expectedRevision: before.revision, reason: 'Native integration test' });
  let rejected = false;
  try { await invoke('save_state', { content: '{broken', expectedRevision: revision, reason: 'Invalid import' }); } catch { rejected = true; }
  const currentRevision = await invoke('save_state', { content, expectedRevision: revision, reason: 'Known recovery baseline' });
  const after = await invoke('load_state');
  const backups = await invoke('list_backups');
  if (backups.some(b => 'content' in b)) throw new Error('Snapshot listing must return metadata only');
  if (backups.length) JSON.parse(await invoke('read_backup', { id: backups[0].id }));
  return { revision: currentRevision, rejected, content: after.content, backups: backups.length };
}, JSON.stringify(imported));
if (!result.rejected || JSON.stringify(JSON.parse(result.content)) !== JSON.stringify(imported)) throw new Error('Native persistence verification failed');
await page.reload(); await page.waitForSelector('.app');
await page.evaluate(() => document.fonts.load('14px "Minecraft"'));
if (!(await page.locator('.app').evaluate(el => getComputedStyle(el).fontFamily)).includes('Minecraft') || await page.locator('.fc-timegrid-allday').count()) throw new Error('Native font or all-day layout is incorrect');
await page.locator('.course-list').getByRole('button', { name: /^Algorithms\s*LEC\s*LAB$/ }).waitFor();
await page.getByRole('button', { name: 'Jump to date', exact: true }).click();
await page.getByRole('textbox', { name: 'Jump to date' }).fill('2026-10-05');
await page.locator('.fc-event').filter({ hasText: 'Algorithms' }).filter({ hasText: 'Lecture' }).waitFor();
const algorithms = page.locator('.fc-event').filter({ hasText: 'Algorithms' }).filter({ hasText: 'Lecture' });
if (await algorithms.count() !== 1 || !(await algorithms.textContent()).includes('16:00–18:00')) throw new Error('Native calendar did not recover its occurrence edit');
await page.screenshot({ path: 'test-results/native-calendar.png' });
await page.getByRole('button', { name: 'Settings & data' }).click();
await page.getByRole('tab', { name: 'Recovery' }).click();
const restore = page.getByRole('button', { name: 'Restore…', exact: true }).first();
if (await restore.count()) {
  await restore.click(); await page.getByRole('button', { name: 'Back up & restore', exact: true }).click();
  await page.waitForSelector('.modal', { state: 'detached' });
} else await page.getByRole('button', { name: 'Close dialog' }).click();
await algorithms.waitFor();
await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
await page.waitForSelector('.png-preview img');
const render = await page.evaluate(async () => {
  const preview = document.querySelector('.png-preview img');
  await preview.decode();
  const canvas = document.createElement('canvas'); canvas.width = preview.naturalWidth; canvas.height = preview.naturalHeight;
  canvas.getContext('2d').drawImage(preview, 0, 0);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  return { width: canvas.width, size: blob.size };
});
if (render.width !== 1240 || render.size < 10_000 || errors.length) throw new Error(`Native render failed: ${JSON.stringify({render, errors})}`);
await page.getByRole('button', { name: 'Close dialog' }).click();
const grouped = await readFile('test-results/grouped-configuration.json', 'utf8');
await page.evaluate(async content => {
  const invoke = window.__TAURI_INTERNALS__.invoke;
  const before = await invoke('load_state');
  await invoke('save_state', { content, expectedRevision: before.revision, reason: 'Native grouped color test' });
}, grouped);
await page.reload(); await page.waitForSelector('.app');
await page.getByRole('button', { name: 'Jump to date', exact: true }).click();
await page.getByRole('textbox', { name: 'Jump to date' }).fill('2026-10-05');
const groupEvents = page.locator('.fc-event').filter({ hasText: 'Algorithms' });
await groupEvents.first().waitFor();
const colors = await groupEvents.evaluateAll(events => events.map(el => getComputedStyle(el).borderColor));
if (colors.length !== 2 || colors[0] !== colors[1] || await groupEvents.filter({ hasText: 'Laboratory' }).count() !== 1 || await groupEvents.filter({ hasText: 'Lecture' }).count() !== 1) throw new Error('Native group color/types did not persist');
if (errors.length) throw new Error(`Native UI errors: ${errors.join(', ')}`);
await page.screenshot({ path: 'test-results/native-refined-calendar.png' });
await page.locator('.course-list').getByRole('button', { name: /^Algorithms\s*LEC\s*LAB$/ }).click();
await page.getByRole('button', { name: 'Ungroup course', exact: true }).click();
await page.reload(); await page.waitForSelector('.app');
const lecture = page.locator('.course-list').getByRole('button', { name: /^Algorithms · Lecture\s*LEC$/ });
const lab = page.locator('.course-list').getByRole('button', { name: /^Algorithms · Laboratory\s*LAB$/ });
await lecture.waitFor(); await lab.waitFor();
if (await lecture.count() !== 1 || await lab.count() !== 1 || errors.length) throw new Error('Native ungrouping did not persist');
await writeFile('test-results/native-smoke.json', JSON.stringify({ persistence: { revision: result.revision, rejectedMalformed: result.rejected, backups: result.backups }, render, grouped: { events: colors.length, borderColor: colors[0] }, ungrouped: { courses: 2, persistedAfterReload: true }, errors }, null, 2));
console.log('Native WebView2 + SQLite persistence, migration, reload, recurrence edit, PNG, Minecraft font, grouping and persistent ungrouping: passed.');
await browser.close();
