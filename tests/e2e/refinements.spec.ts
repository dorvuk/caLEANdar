import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function sample(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Preview the sample timetable' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Import timetable', exact: true }).click();
  await page.getByRole('button', { name: 'Jump to date', exact: true }).click();
  await page.getByRole('textbox', { name: 'Jump to date' }).fill('2026-10-05');
}
async function selectFriday(page: Page, first: string, last: string) {
  const col = await page.locator('.fc-timegrid-col[data-date="2026-10-09"]').boundingBox();
  const start = await page.locator(`.fc-timegrid-slot-lane[data-time="${first}:00"]`).boundingBox();
  const end = await page.locator(`.fc-timegrid-slot-lane[data-time="${last}:00"]`).boundingBox();
  if (!col || !start || !end) throw new Error('Calendar slots are not visible.');
  const x = col.x + col.width / 2;
  await page.mouse.move(x, start.y + start.height / 2); await page.mouse.down();
  await page.mouse.move(x, end.y + end.height / 2, { steps: 12 }); await page.mouse.up();
}
test('calendar selection preserves long and short durations; pixel font, compact courses and clear date navigation', async ({ page }) => {
  await sample(page);
  await page.evaluate(() => document.fonts.load('14px "Minecraft"'));
  expect(await page.locator('.app').evaluate(el => getComputedStyle(el).fontFamily)).toContain('Minecraft');
  expect(await page.evaluate(() => [...document.fonts].some(font => font.family === 'Minecraft' && font.status === 'loaded'))).toBe(true);
  await expect(page.locator('.fc-timegrid-divider, .fc-timegrid-allday, .local-status, .calendar-footer, .shortcut')).toHaveCount(0);
  await expect(page.locator('.import-button')).toHaveText('Import timetable');
  await expect(page.locator('.add-course')).toHaveText('New course');
  expect((await page.locator('.course-row').first().boundingBox())!.height).toBeLessThan(42);
  await expect(page.getByRole('button', { name: 'Jump to date', exact: true })).toContainText('5 Oct 2026');
  await page.getByRole('button', { name: 'Next week' }).click();
  await expect(page.locator('h1')).toContainText('12–16 October 2026');
  await page.getByRole('button', { name: 'Jump to date', exact: true }).click();
  await page.getByRole('dialog', { name: 'Choose a date' }).getByRole('button', { name: '2026-10-05', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await selectFriday(page, '09:30', '11:30');
  await expect(page.getByLabel('Starts', { exact: true })).toHaveValue('09:30');
  await expect(page.getByLabel('Ends', { exact: true })).toHaveValue('12:00');
  await page.getByLabel('Course or activity name').fill('Selected studio');
  await page.getByRole('checkbox', { name: 'Repeat every week', exact: true }).uncheck();
  await page.getByLabel('Course color hex').fill('#b85b30');
  await page.getByRole('button', { name: 'Add to my calendar' }).click();
  await expect(page.locator('.fc-event').filter({ hasText: 'Selected studio' })).toContainText('09:30–12:00');
  await selectFriday(page, '08:00', '08:00');
  await expect(page.getByLabel('Starts', { exact: true })).toHaveValue('08:00');
  await expect(page.getByLabel('Ends', { exact: true })).toHaveValue('08:30');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.screenshot({ path: 'test-results/refined-calendar.png', fullPage: true });
});
test('automatic grouping, ungrouping and manual regrouping retain course colors and types through reimport and transfer', async ({ page }) => {
  await sample(page);
  const sidebar = page.locator('.course-list');
  const group = sidebar.getByRole('button', { name: /^Algorithms\s*LEC\s*LAB$/ });
  await expect(group).toHaveCount(1);
  await group.click();
  await page.getByLabel('Course color hex').fill('#9158ba');
  await page.getByRole('button', { name: 'Save course', exact: true }).click();
  const beforeColor = await page.locator('.fc-event').filter({ hasText: 'Algorithms' }).filter({ hasText: 'Lecture' }).evaluate(el => getComputedStyle(el).borderColor);
  expect(beforeColor).not.toBe('rgb(48, 76, 63)');
  await group.click();
  await page.getByRole('button', { name: 'Ungroup course', exact: true }).click();
  const lecture = sidebar.getByRole('button', { name: /^Algorithms · Lecture\s*LEC$/ });
  const lab = sidebar.getByRole('button', { name: /^Algorithms · Laboratory\s*LAB$/ });
  await expect(lecture).toHaveCount(1); await expect(lab).toHaveCount(1);
  await page.reload();
  await page.getByRole('button', { name: 'Jump to date', exact: true }).click();
  await page.getByRole('textbox', { name: 'Jump to date' }).fill('2026-10-05');
  await expect(lecture).toHaveCount(1); await expect(lab).toHaveCount(1);
  const updated = await page.evaluate(() => JSON.parse(JSON.parse(localStorage.getItem('caleandar.preview.v1')!).content).sources[0].content.replaceAll('LOCATION:P01 · FRI', 'LOCATION:R99 · FRI'));
  await page.evaluate(content => { const transfer = new DataTransfer(); transfer.items.add(new File([content], 'fri-sample.ics')); document.querySelector('.app')!.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true })); }, updated);
  await page.getByRole('dialog').getByRole('button', { name: 'Import timetable', exact: true }).click();
  await expect(lecture).toHaveCount(1); await expect(lab).toHaveCount(1);
  await lecture.click();
  await page.getByText('Group lectures, labs & tutorials', { exact: true }).click();
  await page.getByLabel('Group name').fill('Algorithms');
  await page.locator('.group-course-options').getByRole('checkbox', { name: /Algorithms · Laboratory/ }).check();
  await page.getByRole('button', { name: 'Group selected courses', exact: true }).click();
  await expect(lab).toHaveCount(0);
  await expect(group).toHaveCount(1);
  const events = page.locator('.fc-event').filter({ hasText: 'Algorithms' });
  await expect(events).toHaveCount(2);
  await expect(events.filter({ hasText: 'Laboratory' })).toHaveCount(1);
  await expect(events.filter({ hasText: 'Lecture' })).toHaveCount(1);
  expect(await events.last().evaluate(el => getComputedStyle(el).borderColor)).toBe(beforeColor);
  await expect(events).toHaveCount(2); await expect(group).toHaveCount(1);
  await expect(events.filter({ hasText: 'Lecture' })).toContainText('R99');
  await page.getByRole('button', { name: 'Settings & data' }).click(); await page.getByRole('tab', { name: 'Recovery' }).click();
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export configuration' }).click();
  await (await downloading).saveAs('test-results/grouped-configuration.json');
  const config = JSON.parse(await readFile('test-results/grouped-configuration.json', 'utf8'));
  expect(config.courses.find((c: { name: string }) => c.name === 'Algorithms').color).toBe('#9158ba');
  await page.getByRole('button', { name: 'Close dialog' }).click(); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.getByRole('button', { name: 'Settings & data' }).click(); await page.getByRole('tab', { name: 'Recovery' }).click();
  const choosing = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'Import configuration' }).click();
  await (await choosing).setFiles('test-results/grouped-configuration.json'); await page.getByRole('button', { name: 'Back up & replace' }).click();
  await page.getByRole('button', { name: 'Jump to date', exact: true }).click(); await page.getByRole('textbox', { name: 'Jump to date' }).fill('2026-10-05');
  await expect(events).toHaveCount(2); await expect(group).toHaveCount(1);
  expect(await events.first().evaluate(el => getComputedStyle(el).borderColor)).toBe(beforeColor);
});

test('toggling weekly repeat retains the chosen final date and complete recurring range', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New course', exact: true }).click();
  await page.getByLabel('Course or activity name').fill('Repeat toggle regression');
  await page.getByLabel('First session').fill('2026-10-12');
  await page.getByLabel('Last eligible date').fill('2027-02-12');
  await page.getByLabel('Starts', { exact: true }).fill('10:00');
  await page.getByLabel('Ends', { exact: true }).fill('12:00');
  const weekly = page.getByRole('checkbox', { name: 'Repeat every week', exact: true });
  await weekly.uncheck();
  await expect(page.getByLabel('Date', { exact: true })).toHaveValue('2026-10-12');
  await page.getByLabel('Date', { exact: true }).fill('2026-10-19');
  await weekly.check();
  await expect(page.getByLabel('Last eligible date')).toHaveValue('2027-02-12');
  await weekly.uncheck(); await weekly.check();
  await expect(page.getByLabel('Last eligible date')).toHaveValue('2027-02-12');
  await expect(page.getByLabel('First session')).toHaveValue('2026-10-19');
  await expect(page.getByLabel('Starts', { exact: true })).toHaveValue('10:00');
  await expect(page.getByLabel('Ends', { exact: true })).toHaveValue('12:00');
  await page.getByRole('button', { name: 'Add to my calendar', exact: true }).click();
  await page.getByRole('button', { name: 'Jump to date', exact: true }).click();
  await page.getByRole('textbox', { name: 'Jump to date' }).fill('2027-02-08');
  await expect(page.locator('.fc-event').filter({ hasText: 'Repeat toggle regression' })).toContainText('10:00–12:00');
});

test('existing saved lecture and lab courses group on upgrade with a recoverable snapshot', async ({ page }) => {
  await sample(page);
  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('caleandar.preview.v1')!);
    const state = JSON.parse(stored.content);
    const lecture = state.courses.find((c: { name: string; deleted?: boolean }) => c.name === 'Algorithms' && !c.deleted);
    const lab = state.courses.find((c: { importedName?: string }) => c.importedName === 'Algorithms — Laboratory');
    lecture.name = lecture.importedName; delete lecture.grouped; delete lecture.autoGroup;
    lab.deleted = false; lecture.color = '#9158ba';
    for (const session of state.sessions.filter((s: { courseId: string }) => s.courseId === lecture.id)) {
      if (session.type === 'Laboratory') session.courseId = lab.id;
      delete session.type;
    }
    localStorage.setItem('caleandar.preview.v1', JSON.stringify({ ...stored, content: JSON.stringify(state) }));
    localStorage.removeItem('caleandar.preview.backups.v1');
  });
  await page.reload();
  await expect(page.locator('.course-list').getByRole('button', { name: /^Algorithms\s*LEC\s*LAB$/ })).toHaveCount(1);
  const saved = await page.evaluate(() => JSON.parse(JSON.parse(localStorage.getItem('caleandar.preview.v1')!).content));
  expect(saved.courses.filter((c: { deleted?: boolean }) => !c.deleted)).toHaveLength(5);
  expect(saved.courses.find((c: { name: string; deleted?: boolean }) => c.name === 'Algorithms' && !c.deleted).color).toBe('#9158ba');
  const reasons = await page.evaluate(() => JSON.parse(localStorage.getItem('caleandar.preview.backups.v1')!).map((b: { reason: string }) => b.reason));
  expect(reasons).toEqual(['Automatically group matching course names']);
});
