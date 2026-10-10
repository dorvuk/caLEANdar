import { invoke, isTauri } from '@tauri-apps/api/core';
import { emptyState, type AppState } from '../core/model';
import { parseConfig, serializeConfig, validateConfig } from '../core/config';
import { autoGroupCourses } from '../core/courses';

interface Snapshot { content: string | null; revision: number }
export interface Backup { id: number; createdAt: string; reason: string }
interface StoredBackup extends Backup { content: string }
const storageKey = 'caleandar.preview.v1';
const backupKey = 'caleandar.preview.backups.v1';
let revision = 0;
export const desktop = isTauri();
let loading: Promise<AppState> | undefined;
export function loadState(): Promise<AppState> {
  return loading ??= readState().finally(() => { loading = undefined; });
}
async function readState(): Promise<AppState> {
  let snapshot: Snapshot;
  if (desktop) {
    snapshot = await invoke<Snapshot>('load_state');
  } else snapshot = JSON.parse(localStorage.getItem(storageKey) ?? '{"content":null,"revision":0}');
  revision = snapshot.revision;
  const state = snapshot.content ? parseConfig(snapshot.content) : emptyState(), grouped = autoGroupCourses(state);
  if (grouped !== state) await saveState(grouped, 'Automatically group matching course names');
  return grouped;
}
export async function saveState(state: AppState, reason = 'Edit'): Promise<void> {
  validateConfig(state); const content = JSON.stringify(state);
  if (desktop) { revision = await invoke<number>('save_state', { content, expectedRevision: revision, reason }); return; }
  const before: Snapshot = JSON.parse(localStorage.getItem(storageKey) ?? '{"content":null,"revision":0}');
  if (before.revision !== revision) throw new Error('The calendar changed in another window. Reload before making further edits.');
  const backups: StoredBackup[] = JSON.parse(localStorage.getItem(backupKey) ?? '[]');
  if (before.content) backups.unshift({ id: Math.max(Date.now(), (backups[0]?.id ?? 0) + 1), createdAt: new Date().toISOString(), reason, content: before.content });
  // Keep the browser fallback small. The desktop stores 50 complete SQLite snapshots.
  const previousBackups = localStorage.getItem(backupKey);
  try {
    localStorage.setItem(backupKey, JSON.stringify(backups.slice(0, 5)));
    localStorage.setItem(storageKey, JSON.stringify({ content, revision: revision + 1 })); revision++;
  } catch {
    if (previousBackups) localStorage.setItem(backupKey, previousBackups); else localStorage.removeItem(backupKey);
    throw new Error('Browser preview storage is full. Export your configuration and use the desktop app.');
  }
}
export async function getBackups(): Promise<Backup[]> {
  return desktop ? invoke<Backup[]>('list_backups') : (JSON.parse(localStorage.getItem(backupKey) ?? '[]') as StoredBackup[]).map(({ content: _, ...metadata }) => metadata);
}
export async function getBackupContent(id: number): Promise<string> {
  if (desktop) return invoke<string>('read_backup', { id });
  const backup = (JSON.parse(localStorage.getItem(backupKey) ?? '[]') as StoredBackup[]).find(b => b.id === id);
  if (!backup) throw new Error('This backup is no longer available. Reopen Recovery to refresh the list.');
  return backup.content;
}
export const exportConfiguration = (state: AppState) => saveFile('caleandar-configuration.json', serializeConfig(state), 'json');
export async function openFile(kind: 'calendar' | 'configuration'): Promise<{ name: string; content: string } | null> {
  if (desktop) return invoke('pick_import', { kind });
  return new Promise(resolve => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = kind === 'calendar' ? '.ics,.ical' : '.json';
    input.onchange = async () => { const file = input.files?.[0]; resolve(file ? { name: file.name, content: await file.text() } : null); };
    input.oncancel = () => resolve(null); input.click();
  });
}
export async function readDrop(path: string): Promise<{ name: string; content: string }> { return invoke('read_import', { path }); }
export async function saveFile(name: string, content: string | Uint8Array, extension: string): Promise<boolean> {
  if (desktop) return invoke('save_export', { name, bytes: [...(typeof content === 'string' ? new TextEncoder().encode(content) : content)], extension });
  const blob = new Blob([typeof content === 'string' ? content : new Uint8Array(content)], { type: extension === 'png' ? 'image/png' : 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); return true;
}
