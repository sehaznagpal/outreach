import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { uid, useData, useStore } from '../store';
import { slug } from '../lib/render';
import type { Link } from '../types';
import { iconProps } from './ui';

/** Company- or person-level links: label, URL, optional auto-link words. */
export function LinksEditor({ scope, companyId, contactId }: { scope: 'company' | 'contact'; companyId: string; contactId?: string }) {
  const d = useData();
  const { mutate } = useStore();
  const rows = d.links.filter((l) => l.scope === scope && (scope === 'company' ? l.company_id === companyId : l.contact_id === contactId));
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ label: '', url: '', words: '' });

  const save = (l: Link) => mutate('saveLink', { link: l }, (x) => ({
    ...x, links: x.links.some((o) => o.id === l.id) ? x.links.map((o) => (o.id === l.id ? l : o)) : [...x.links, l],
  }));
  const add = async () => {
    if (!f.label.trim()) return;
    const l: Link = {
      id: uid(), label: f.label.trim(), url: f.url.trim(), key: slug(f.label), auto_words: f.words.trim(), is_primary: false,
      scope, company_id: companyId, contact_id: contactId || '', created_at: '',
    };
    setF({ label: '', url: '', words: '' });
    setAdding(false);
    await save(l);
  };

  return (
    <div className="col" style={{ gap: 8 }}>
      {rows.map((l) => (
        <div key={l.id} className="col" style={{ gap: 6, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)' }}>
          <div className="row"><span className="grow small">{l.label} <span className="faint">{`{{link:${l.key}}}`}</span></span>
            <button className="icon-btn" style={{ width: 24, height: 24 }} aria-label={`Delete ${l.label}`}
              onClick={() => mutate('deleteLink', { id: l.id }, (x) => ({ ...x, links: x.links.filter((o) => o.id !== l.id) }))}><X size={14} strokeWidth={1.5} /></button></div>
          <input className="input" style={{ height: 32 }} aria-label={`${l.label} URL`} defaultValue={l.url} placeholder="https://" key={l.id + l.url}
            onBlur={(e) => e.target.value.trim() !== l.url && save({ ...l, url: e.target.value.trim() })} />
          <input className="input" style={{ height: 32 }} aria-label={`${l.label} auto-link words`} defaultValue={l.auto_words} placeholder="Auto-link words" key={l.id + 'w' + l.auto_words}
            onBlur={(e) => e.target.value.trim() !== l.auto_words && save({ ...l, auto_words: e.target.value.trim() })} />
        </div>
      ))}
      {adding ? (
        <div className="col" style={{ gap: 6 }}>
          <input className="input" autoFocus placeholder="Label" aria-label="Link label" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
          <input className="input" placeholder="https://" aria-label="Link URL" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
          <input className="input" placeholder="Auto-link words (optional)" aria-label="Auto-link words" value={f.words} onChange={(e) => setF({ ...f, words: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') void add(); }} />
          <div className="row"><button className="btn sm primary" disabled={!f.label.trim()} onClick={() => void add()}>Add link</button>
            <button className="btn sm ghost" onClick={() => setAdding(false)}>Cancel</button></div>
        </div>
      ) : (
        <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAdding(true)}><Plus {...iconProps} />Add link</button>
      )}
    </div>
  );
}
