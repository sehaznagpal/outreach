import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Bold, ChevronDown, Italic, Link2, Plus } from 'lucide-react';
import type { ContactStatus, CompanyStatus, BatchStatus } from '../types';

const ICON = { size: 16, strokeWidth: 1.5 };
export const iconProps = ICON;

// ---------- hooks ----------

export function useClickOutside(refs: Array<React.RefObject<HTMLElement>>, onOut: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const h = (e: MouseEvent) => {
      if (refs.some((r) => r.current?.contains(e.target as Node))) return;
      onOut();
    };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onOut(); };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function useDebounced<T extends (...a: any[]) => void>(fn: T, ms = 600) {
  const t = useRef<ReturnType<typeof setTimeout>>();
  const f = useRef(fn);
  f.current = fn;
  useEffect(() => () => clearTimeout(t.current), []);
  return useCallback((...a: Parameters<T>) => {
    clearTimeout(t.current);
    t.current = setTimeout(() => f.current(...a), ms);
  }, [ms]);
}

// ---------- popover ----------

export function Popover({ anchor, onClose, children, width }: { anchor: HTMLElement | null; onClose: () => void; children: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; w: number } | null>(null);
  useLayoutEffect(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const w = Math.max(width || 0, r.width, 240);
    const left = Math.min(r.left, window.innerWidth - w - 12);
    const below = window.innerHeight - r.bottom;
    const top = below < 260 && r.top > below ? Math.max(12, r.top - 326) : r.bottom + 6;
    setPos({ top, left: Math.max(12, left), w });
  }, [anchor, width]);
  useClickOutside([ref, { current: anchor }], onClose, true);
  if (!pos) return null;
  return createPortal(
    <div className="pop" ref={ref} style={{ top: pos.top, left: pos.left, width: pos.w }}>{children}</div>,
    document.body,
  );
}

export interface Option { value: string; label: string; hint?: string }

export function Combo({ value, options, onChange, placeholder = 'Select', bare, onAdd, addLabel = 'Add new', clearLabel, ariaLabel }: {
  value: string; options: Option[]; onChange: (v: string) => void; placeholder?: string; bare?: boolean;
  onAdd?: (text: string) => void; addLabel?: string; clearLabel?: string; ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const btn = useRef<HTMLButtonElement>(null);
  const cur = options.find((o) => o.value === value);
  const list = options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()));
  const close = () => { setOpen(false); setQ(''); };
  const exact = options.some((o) => o.label.toLowerCase() === q.trim().toLowerCase());
  return (
    <>
      <button ref={btn} type="button" aria-label={ariaLabel} className={`combo-btn ${bare ? 'bare' : ''}`} onClick={() => setOpen((o) => !o)}>
        <span className={`trunc ${cur ? '' : 'ph'}`}>{cur ? cur.label : value || placeholder}</span>
        <ChevronDown size={14} strokeWidth={1.5} className="faint" />
      </button>
      {open && (
        <Popover anchor={btn.current} onClose={close}>
          <input autoFocus className="input" placeholder="Type to filter" value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (list[0]) { onChange(list[0].value); close(); }
                else if (onAdd && q.trim()) { onAdd(q.trim()); close(); }
              }
            }} />
          {clearLabel && <button type="button" className="opt" onClick={() => { onChange(''); close(); }}><span className="muted">{clearLabel}</span></button>}
          {list.map((o) => (
            <button type="button" key={o.value} className={`opt ${o.value === value ? 'active' : ''}`} onClick={() => { onChange(o.value); close(); }}>
              <span>{o.label}</span>{o.hint && <span className="hint">{o.hint}</span>}
            </button>
          ))}
          {!list.length && !onAdd && <div className="opt muted">No matches</div>}
          {onAdd && q.trim() && !exact && (
            <button type="button" className="opt add" onClick={() => { onAdd(q.trim()); close(); }}><span><Plus size={14} strokeWidth={1.5} style={{ verticalAlign: -2 }} /> {addLabel} “{q.trim()}”</span></button>
          )}
        </Popover>
      )}
    </>
  );
}

// ---------- small pieces ----------

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return createPortal(
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" disabled={disabled} style={disabled ? { opacity: 0.4, cursor: 'default' } : undefined} onClick={() => onChange(!checked)} />;
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

export function Empty({ text, action, onAction, center }: { text: string; action?: string; onAction?: () => void; center?: boolean }) {
  return (
    <div className={`empty ${center ? 'center' : ''}`}>
      <p>{text}</p>
      {action && <button className="btn" onClick={onAction}>{action}</button>}
    </div>
  );
}

const CONTACT_TONE: Record<ContactStatus, [string, string]> = {
  draft: ['', 'Draft'], ready: ['yellow', 'Ready'], scheduled: ['yellow', 'Scheduled'], sent: ['sky', 'Sent'],
  followed_up: ['sky', 'Followed up'], replied: ['ok', 'Replied'], bounced: ['danger', 'Bounced'], stopped: ['', 'Stopped'],
};
export function StatusPill({ status }: { status: ContactStatus }) {
  const [tone, label] = CONTACT_TONE[status] || ['', status];
  return <span className="pill"><span className={`dot ${tone}`} />{label}</span>;
}
export function CompanyStatusPill({ status }: { status: CompanyStatus }) {
  const tone = status === 'active' ? 'ok' : status === 'paused' ? 'ember' : status === 'replied' ? 'sky' : '';
  return <span className="pill"><span className={`dot ${tone}`} />{status[0].toUpperCase() + status.slice(1)}</span>;
}
export function BatchStatusPill({ status }: { status: BatchStatus }) {
  const tone = status === 'planned' ? 'yellow' : status === 'sent' ? 'ok' : status === 'partial' ? 'ember' : status === 'sending' ? 'sky' : '';
  return <span className="pill"><span className={`dot ${tone}`} />{status[0].toUpperCase() + status.slice(1)}</span>;
}

export function CountUp({ to, className }: { to: number; className?: string }) {
  const [n, setN] = useState(0);
  const done = useRef(false);
  useEffect(() => {
    if (done.current) { setN(to); return; }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || to === 0) { setN(to); done.current = true; return; }
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 700);
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick); else done.current = true;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <span className={`tnum ${className || ''}`}>{n}</span>;
}

export function Ring({ value, max, size = 92 }: { value: number; max: number; size?: number }) {
  const r = size / 2 - 7;
  const c = 2 * Math.PI * r;
  const p = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${value} of ${max}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth="6" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--yellow)" strokeWidth="6" strokeLinecap="round"
        strokeDasharray={`${c * p} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dasharray 600ms ease-out' }} />
    </svg>
  );
}

// ---------- rich text (bold, italic, link, line breaks only) ----------

export interface RichHandle { insert: (text: string) => void; focus: () => void }

export const RichText = forwardRef<RichHandle, { value: string; onChange: (html: string) => void; onFocus?: () => void; placeholder?: string; links?: Array<{ key: string; label: string }> }>(
  function RichText({ value, onChange, onFocus, placeholder, links }, ref) {
    const el = useRef<HTMLDivElement>(null);
    const saved = useRef<Range | null>(null);
    const menuBtn = useRef<HTMLButtonElement>(null);
    const [menu, setMenu] = useState(false);
    useEffect(() => {
      if (el.current && el.current.innerHTML !== value) el.current.innerHTML = value;
    }, [value]);
    useImperativeHandle(ref, () => ({
      focus: () => el.current?.focus(),
      insert: (text: string) => {
        const node = el.current;
        if (!node) return;
        const sel = window.getSelection();
        if (!sel || !node.contains(sel.anchorNode)) {
          node.focus();
          const range = document.createRange();
          range.selectNodeContents(node);
          range.collapse(false);
          sel?.removeAllRanges();
          sel?.addRange(range);
        }
        document.execCommand('insertText', false, text);
        onChange(node.innerHTML);
      },
    }));
    const pickLink = (key: string) => {
      setMenu(false);
      const node = el.current;
      if (!node) return;
      node.focus();
      const sel = window.getSelection();
      const range = saved.current;
      if (range && sel) { sel.removeAllRanges(); sel.addRange(range); }
      if (range && !range.collapsed) document.execCommand('createLink', false, `link:${key}`);
      else document.execCommand('insertText', false, `{{link:${key}}}`);
      onChange(node.innerHTML);
    };
    const cmd = (c: string, arg?: string) => {
      el.current?.focus();
      document.execCommand(c, false, arg);
      if (el.current) onChange(el.current.innerHTML);
    };
    return (
      <div>
        <div className="editor-bar">
          <button type="button" className="icon-btn" aria-label="Bold" onMouseDown={(e) => { e.preventDefault(); cmd('bold'); }}><Bold {...ICON} /></button>
          <button type="button" className="icon-btn" aria-label="Italic" onMouseDown={(e) => { e.preventDefault(); cmd('italic'); }}><Italic {...ICON} /></button>
          <button type="button" className="icon-btn" aria-label="Link" onMouseDown={(e) => {
            e.preventDefault();
            const url = window.prompt('Link URL');
            if (url) cmd('createLink', url);
          }}><Link2 {...ICON} /></button>
          {links && links.length > 0 && (
            <>
              <button ref={menuBtn} type="button" className="btn sm ghost" onMouseDown={(e) => {
                e.preventDefault();
                const sel = window.getSelection();
                saved.current = sel && sel.rangeCount && el.current?.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
                setMenu((m) => !m);
              }}>Link to <ChevronDown size={14} strokeWidth={1.5} /></button>
              {menu && (
                <Popover anchor={menuBtn.current} onClose={() => setMenu(false)}>
                  {links.map((l) => <button key={l.key} type="button" className="opt" onClick={() => pickLink(l.key)}><span>{l.label}</span><span className="hint">{`{{link:${l.key}}}`}</span></button>)}
                </Popover>
              )}
            </>
          )}
        </div>
        <div ref={el} className="editor" contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label="Email body"
          data-ph={placeholder} onFocus={onFocus} onInput={() => el.current && onChange(el.current.innerHTML)}
          onPaste={(e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); }} />
      </div>
    );
  },
);

export function SavedHint({ show }: { show: boolean }) {
  return <span className="xs faint" aria-live="polite">{show ? 'Saved' : ''}</span>;
}
