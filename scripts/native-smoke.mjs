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
const result = await page.evaluate(async content => {
  const invoke = window.__TAURI_INTERNALS__.invoke;
  const before = await invoke('load_state');
  const revision = await invoke('save_state', { content, expectedRevision: before.revision, reason: 'Native integration test' });
  let rejected = false;
  try { await invoke('save_state', { content: '{broken', expectedRevision: revision, reason: 'Invalid import' }); } catch { rejected = true; }
  const after = await invoke('load_state');
  const backups = await invoke('list_backups');
  if (backups.some(b => 'content' in b)) throw new Error('Snapshot listing must return metadata only');
  if (backups.length) JSON.parse(await invoke('read_backup', { id: backups[0].id }));
  return { revision, rejected, content: after.content, backups: backups.length };
}, JSON.stringify(imported));
if (!result.rejected || JSON.stringify(JSON.parse(result.content)) !== JSON.stringify(imported)) throw new Error('Native persistence verification failed');
await page.reload(); await page.waitForSelector('.app');
await page.getByRole('textbox', { name: 'Jump to date' }).fill('2026-10-05');
await page.locator('.fc-event').filter({ hasText: 'Algorithms — Lectures' }).waitFor();
const algorithms = page.locator('.fc-event').filter({ hasText: 'Algorithms — Lectures' });
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
await writeFile('test-results/native-smoke.json', JSON.stringify({ persistence: { revision: result.revision, rejectedMalformed: result.rejected, backups: result.backups }, render, errors }, null, 2));
console.log('Native WebView2 + SQLite persistence, reload, recurrence edit and PNG canvas: passed.');
await browser.close();
