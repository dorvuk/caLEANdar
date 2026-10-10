import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function jump(page: Page, day: string) {
  await page.getByRole('button', { name: 'Jump to date', exact: true }).click();
  await page.getByRole('textbox', { name: 'Jump to date' }).fill(day);
}

test('university workflow: import, recurring move, exception, cancellation, settings, PNG and JSON transfer', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Preview the sample timetable' }).click();
  await expect(page.getByRole('dialog')).toContainText('Algorithms — Lectures');
  await page.getByRole('dialog').getByRole('button', { name: 'Import timetable', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await jump(page, '2026-10-05');
  await expect(page.locator('.fc-event').filter({ hasText: 'Algorithms' }).filter({ hasText: 'Lecture' })).toHaveCount(1);
  await page.locator('.fc-event').filter({ hasText: 'Algorithms' }).filter({ hasText: 'Lecture' }).click();
  await page.getByRole('button', { name: 'All weeks', exact: true }).click();
  await page.getByLabel('Weekly day & start time').fill('2026-10-05T10:00');
  await page.getByLabel('End date & time').fill('2026-10-05T12:00');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  const algorithms = page.locator('.fc-event').filter({ hasText: 'Algorithms' }).filter({ hasText: 'Lecture' });
  await expect(algorithms).toHaveCount(1); await expect(algorithms).toContainText('10:00–12:00');
  await algorithms.click();
  await page.getByLabel('Start date & time').fill('2026-10-06T16:00'); await page.getByLabel('End date & time').fill('2026-10-06T18:00');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(algorithms).toHaveCount(1); await expect(algorithms).toContainText('16:00–18:00');
  await jump(page, '2026-10-12');
  await expect(algorithms).toContainText('10:00–12:00'); await algorithms.click();
  await page.getByRole('button', { name: 'Cancel this occurrence', exact: true }).click(); await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(algorithms).toHaveCount(0);
  await page.locator('.course-list').getByRole('button', { name: /^Algorithms\s*LEC\s*LAB$/ }).click();
  await page.locator('.list-row').filter({ hasText: 'Cancelled' }).getByRole('button', { name: 'Restore', exact: true }).click();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(algorithms).toContainText('10:00–12:00');
  await algorithms.click(); await page.getByRole('button', { name: 'Cancel this occurrence', exact: true }).click(); await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(algorithms).toHaveCount(0);
  await jump(page, '2026-10-05'); await expect(algorithms).toContainText('16:00–18:00');
  const updatedTimetable = await page.evaluate(() => JSON.parse(JSON.parse(localStorage.getItem('caleandar.preview.v1')!).content).sources[0].content.replace('LOCATION:P01 · FRI', 'LOCATION:R99 · FRI'));
  await page.evaluate(content => { const transfer = new DataTransfer(); transfer.items.add(new File([content], 'fri-sample.ics', { type: 'text/calendar' })); document.querySelector('.app')!.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true })); }, updatedTimetable);
  await page.getByRole('dialog').getByRole('button', { name: 'Import timetable', exact: true }).click();
  await expect(algorithms).toHaveCount(1); await expect(algorithms).toContainText('16:00–18:00'); await expect(algorithms).toContainText('R99');
  await page.getByRole('button', { name: 'New course' }).click(); await page.getByLabel('Course or activity name').fill('Study group'); await page.getByLabel('First session').fill('2026-10-07'); await page.getByLabel('Last eligible date').fill('2027-01-15'); await page.getByLabel('Starts', { exact: true }).fill('17:00'); await page.getByLabel('Ends', { exact: true }).fill('18:00'); await page.getByRole('button', { name: 'Add to my calendar' }).click();
  await expect(page.locator('.fc-event').filter({ hasText: 'Study group' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Settings & data' }).click(); await page.getByLabel('Accent hex value').fill('#3f455e'); await page.getByLabel('Interface text size').fill('15'); await page.getByRole('checkbox', { name: 'Instructor', exact: true }).check(); await page.getByRole('tab', { name: 'Calendar', exact: true }).click(); await page.getByRole('checkbox', { name: 'Academic overlays' }).uncheck(); await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.locator('.app')).toHaveAttribute('style', /#3f455e/);
  await page.reload(); await jump(page, '2026-10-05'); await expect(algorithms).toContainText('16:00–18:00');
  await page.screenshot({ path: 'test-results/calendar.png', fullPage: true });
  await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
  const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save PNG', exact: true }).click();
  const download = await downloadPromise; await download.saveAs('test-results/timetable.png');
  const png = await readFile('test-results/timetable.png'); expect([...png.subarray(0, 8)]).toEqual([137,80,78,71,13,10,26,10]); expect(png.readUInt32BE(16)).toBe(2480); expect(png.length).toBeGreaterThan(20_000);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Settings & data' }).click(); await page.getByRole('tab', { name: 'Recovery' }).click();
  const configDownloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export configuration' }).click(); const configDownload = await configDownloadPromise; await configDownload.saveAs('test-results/configuration.json');
  const config = JSON.parse(await readFile('test-results/configuration.json', 'utf8')); expect(config.schemaVersion).toBe(1); expect(Object.keys(config.exceptions)).toHaveLength(2); expect(config.settings.accent).toBe('#3f455e');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.evaluate(() => localStorage.clear()); await page.reload();
  const fileChooserPromise = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'Settings & data' }).click(); await page.getByRole('tab', { name: 'Recovery' }).click(); await page.getByRole('button', { name: 'Import configuration' }).click(); const chooser = await fileChooserPromise; await chooser.setFiles('test-results/configuration.json');
  await page.getByRole('button', { name: 'Back up & replace' }).click(); await jump(page, '2026-10-05');
  await expect(algorithms).toHaveCount(1); await expect(algorithms).toContainText('16:00–18:00'); await expect(page.locator('.app')).toHaveAttribute('style', /#3f455e/); expect(errors).toEqual([]);
});

test('native-like file drop preview and date views work; malformed config preserves calendar', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Preview the sample timetable' }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Import timetable', exact: true }).click(); await jump(page, '2026-10-05');
  await page.getByRole('button', { name: 'Month', exact: true }).click(); await expect(page.locator('.fc-dayGridMonth-view')).toBeVisible(); await page.getByRole('button', { name: 'Day', exact: true }).click(); await expect(page.locator('.fc-timeGridDay-view')).toBeVisible(); await page.getByRole('button', { name: 'Week', exact: true }).click();
  await page.evaluate(() => { const transfer = new DataTransfer(); transfer.items.add(new File(['{"schemaVersion":99}'], 'bad.json', { type: 'application/json' })); document.querySelector('.app')!.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true })); });
  await expect(page.getByRole('dialog')).toContainText('unsupported'); await expect(page.getByRole('button', { name: 'Back up & replace' })).toBeDisabled(); await page.getByRole('button', { name: 'Close dialog' }).click(); await expect(page.locator('.fc-event').filter({ hasText: 'Algorithms' }).filter({ hasText: 'Lecture' })).toHaveCount(1);
});
