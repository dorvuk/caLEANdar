import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type IconName = 'plus' | 'left' | 'right' | 'settings' | 'upload' | 'download' | 'calendar' | 'check' | 'close' | 'sun' | 'eye' | 'book' | 'arrow' | 'undo';
const paths: Record<IconName, string> = {
  plus: 'M8 2v12M2 8h12', left: 'M10 3 5 8l5 5', right: 'm6 3 5 5-5 5', close: 'm3 3 10 10M13 3 3 13',
  settings: 'M5 2h6v2h3v3h-2v2h2v3h-3v2H5v-2H2V9h2V7H2V4h3ZM6 6h4v4H6Z',
  upload: 'M2 10v4h12v-4M8 11V2M4 6l4-4 4 4', download: 'M2 10v4h12v-4M8 2v9M4 7l4 4 4-4',
  calendar: 'M2 3h12v11H2ZM2 6h12M5 1v4M11 1v4M5 9h2v2H5Z', check: 'm2 8 4 4 8-9',
  sun: 'M5 5h6v6H5ZM8 0v3M8 13v3M0 8h3M13 8h3M2 2l2 2M12 12l2 2M2 14l2-2M12 4l2-2',
  eye: 'm1 8 4-4h6l4 4-4 4H5ZM7 7h2v2H7Z', book: 'M2 2h5l1 2 1-2h5v12H9l-1-2-1 2H2ZM8 4v8',
  arrow: 'M2 8h12M9 3l5 5-5 5', undo: 'M5 2 1 6l4 4M1 6h8a5 5 0 0 1 0 10',
};
export function Icon({ name, size = 16 }: { name: IconName; size?: number }) { return <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="miter" aria-hidden="true"><path d={paths[name]} /></svg>; }
export function Modal({ title, subtitle, onClose, children, wide = false }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const app = document.querySelector('.app');
    if (app && panel.current) {
      const style = getComputedStyle(app);
      for (const key of ['--accent', '--paper', '--ink', '--muted', '--border', '--sidebar', '--hover', '--tone', '--ui-scale']) panel.current.style.setProperty(key, style.getPropertyValue(key));
      panel.current.style.fontFamily = style.fontFamily;
      panel.current.style.colorScheme = style.colorScheme;
    }
    const root = document.getElementById('root')!; root.inert = true;
    const focus = () => panel.current?.querySelector<HTMLElement>('input:not([type=checkbox]), select, button')?.focus();
    focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if (e.key === 'Tab') {
        const items = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]') ?? [])].filter(el => el.offsetParent !== null);
        const first = items[0], last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { root.inert = false; document.removeEventListener('keydown', key); previous?.focus(); };
  }, [onClose]);
  return createPortal(<div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={panel} className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <header className="modal-header"><div><div className="eyebrow">caLEANdar / {subtitle ?? 'YOUR CALENDAR'}</div><h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><Icon name="close" /></button></header>
      {children}
    </div>
  </div>, document.body);
}
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) { return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) { return <label className="toggle"><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} /><span>{label}</span></label>; }
export function ErrorText({ error }: { error: string }) { return error ? <p className="error" role="alert">{error}</p> : null; }
