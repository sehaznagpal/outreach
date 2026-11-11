import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { uid, useData, useStore } from '../store';
import { RichText, SavedHint, useDebounced, type RichHandle, iconProps } from '../components/ui';
import { iframeDoc, renderCopy, renderSignature, resolveLinks, SAMPLE, slug, VARIABLES } from '../lib/render';
import { dateOf, fmtShort } from '../lib/dates';
import { csv, type Copy, type Link, type Signature } from '../types';

type Tab = 'emails' | 'followups' | 'links' | 'signatures';
const TABS: Array<{ id: Tab; label: string; action: string }> = [
  { id: 'emails', label: 'Emails', action: 'New email' },
  { id: 'followups', label: 'Follow-ups', action: 'New follow-up' },
  { id: 'links', label: 'Links', action: 'New link' },
  { id: 'signatures', label: 'Signatures', action: 'New signature' },
];
const TAGS = ['text', 'links', 'opening', 'signature', 'image'];

export function Content() {
  const [tab, setTab] = useState<Tab>('emails');
  const [req, setReq] = useState(0);
  const cur = TABS.find((t) => t.id === tab)!;
  return (
    <>
      <div className="page-head">
        <div><h1 className="page-title">Content</h1><p className="page-sub">Everything that goes into your emails: bodies, links and signatures.</p></div>
        <button className="btn primary" onClick={() => setReq((n) => n + 1)}>{cur.action}</button>
      </div>
      <div className="tabs" role="tablist" aria-label="Content">
        {TABS.map((t) => <button key={t.id} role="tab" className="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>
      {(tab === 'emails' || tab === 'followups') && <EmailsTab key={tab} kind={tab === 'emails' ? 'first' : 'followup'} req={req} />}
      {tab === 'links' && <LinksTab req={req} />}
      {tab === 'signatures' && <SignaturesTab req={req} />}
    </>
  );
}

/** Runs `fn` each time the header button is pressed (not on first render). */
function useCreateRequest(req: number, fn: () => void) {
  const first = useRef(req);
  useEffect(() => { if (req !== first.current) fn(); }, [req]); // eslint-disable-line react-hooks/exhaustive-deps
}

// ---------- Emails + Follow-ups ----------

const blankCopy = (kind: 'first' | 'followup'): Copy => ({
  id: '', name: '', kind, tags: '', subject: '', body_html: '', uses_vars: '', image_url: '',
  signature_id: '', auto_link: true, archived: false, updated_at: '',
});

function EmailsTab({ kind, req }: { kind: 'first' | 'followup'; req: number }) {
  const d = useData();
  const { mutate, savedAt } = useStore();
  const noun = kind === 'first' ? 'email' : 'follow-up';
  const [showArchived, setShowArchived] = useState(false);
  const [draft, setDraft] = useState<Copy | null>(null);
  const [dirty, setDirty] = useState(false);
  const body = useRef<RichHandle>(null);
  const subject = useRef<HTMLInputElement>(null);
  const last = useRef<'subject' | 'body'>('body');
  useCreateRequest(req, () => { setDraft(blankCopy(kind)); setDirty(false); });

  const globalLinks = useMemo(() => d.links.filter((l) => l.scope === 'global').sort((a, b) => Number(b.is_primary) - Number(a.is_primary)), [d.links]);
  const linkMap = useMemo(() => resolveLinks(d), [d.links]); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    const m: Record<string, { uses: number; replied: number; people: number }> = {};
    const seen: Record<string, Set<string>> = {};
    d.sendlog.filter((r) => r.result === 'ok' && r.copy_id).forEach((r) => {
      const s = m[r.copy_id] || (m[r.copy_id] = { uses: 0, replied: 0, people: 0 });
      s.uses++;
      const set = seen[r.copy_id] || (seen[r.copy_id] = new Set());
      if (!set.has(r.contact_id)) {
        set.add(r.contact_id);
        s.people++;
        if (d.contacts.find((c) => c.id === r.contact_id)?.replied_at) s.replied++;
      }
    });
    return m;
  }, [d.sendlog, d.contacts]);

  const list = d.copies.filter((c) => c.kind === kind && (showArchived || !c.archived)).sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));

  const save = useDebounced((c: Copy) => {
    if (!c.id || !c.name.trim()) return;
    mutate('saveCopy', { copy: c }, (x) => ({ ...x, copies: x.copies.map((y) => (y.id === c.id ? { ...c, updated_at: y.updated_at } : y)) })).then(() => setDirty(false));
  }, 800);

  const edit = (patch: Partial<Copy>) => {
    if (!draft) return;
    const next = { ...draft, ...patch };
    setDraft(next);
    if (next.id) { setDirty(true); save(next); }
  };

  const insertVar = (text: string) => {
    if (last.current === 'subject' && subject.current) {
      const el = subject.current;
      const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a;
      edit({ subject: el.value.slice(0, a) + text + el.value.slice(b) });
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + text.length, a + text.length); });
    } else body.current?.insert(text);
  };

  const create = async () => {
    if (!draft || !draft.name.trim()) return;
    const res = await mutate<{ id: string }>('saveCopy', { copy: { ...draft, id: undefined } });
    if (res?.id) setDraft({ ...draft, id: res.id });
  };
  const duplicate = async (c: Copy) => {
    const res = await mutate<{ id: string }>('saveCopy', { copy: { ...c, id: undefined, name: `${c.name} copy` } });
    if (res?.id) setDraft({ ...c, id: res.id, name: `${c.name} copy` });
  };
  const archive = (c: Copy) => {
    const archived = !c.archived;
    mutate('archiveCopy', { id: c.id, archived }, (x) => ({ ...x, copies: x.copies.map((y) => (y.id === c.id ? { ...y, archived } : y)) }));
    if (draft?.id === c.id) setDraft({ ...draft, archived });
  };

  const vars = { ...SAMPLE, portfolio_url: linkMap.portfolio?.url || '', sender_name: d.settings.sender_name || 'Sehaz' };
  const rendered = draft ? renderCopy(draft, vars, linkMap, d.signatures) : null;
  const emptyLinks = rendered ? rendered.missing.filter((m) => m.startsWith('link:')) : [];
  const unknownVars = rendered ? rendered.missing.filter((m) => !m.startsWith('link:') && !(VARIABLES as readonly string[]).includes(m)) : [];

  return (
    <div className="copy-layout">
      <div>
        <div className="row" style={{ marginBottom: 14, justifyContent: 'flex-end' }}>
          <label className="row small muted"><input type="checkbox" className="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />Archived</label>
        </div>
        {!list.length && (
          <div className="empty"><p>No {noun}s yet.</p><button className="link-btn" onClick={() => { setDraft(blankCopy(kind)); setDirty(false); }}>New {noun}</button></div>
        )}
        {list.map((c) => {
          const s = stats[c.id];
          return (
            <button key={c.id} className={`copy-item ${draft?.id === c.id ? 'active' : ''}`} onClick={() => { setDraft({ ...c }); setDirty(false); }}>
              <div className="row"><span className="nm grow trunc" style={{ opacity: c.archived ? 0.5 : 1 }}>{c.name}</span>{c.archived && <span className="pill">Archived</span>}</div>
              <div className="tagrow">{csv(c.tags).map((t) => <span key={t} className="pill">{t}</span>)}</div>
              <div className="xs faint">
                Edited {c.updated_at ? fmtShort(dateOf(c.updated_at)) : 'never'} · used {s?.uses || 0}×{s && s.people ? ` · ${Math.round((s.replied / s.people) * 100)}% replied` : ''}
              </div>
            </button>
          );
        })}
      </div>

      <div>
        {!draft ? <p className="muted">Select {kind === 'first' ? 'an' : 'a'} {noun} to edit it.</p> : (
          <div className="col" style={{ gap: 20 }}>
            <div className="field"><label htmlFor="cp-name">Name</label><input id="cp-name" className="input" value={draft.name} onChange={(e) => edit({ name: e.target.value })} /></div>
            <div className="field"><label>Tags</label>
              <div className="tagpick">{TAGS.map((t) => {
                const on = csv(draft.tags).includes(t);
                return <button key={t} type="button" className={`pill ${on ? 'selected' : ''}`} aria-pressed={on}
                  onClick={() => edit({ tags: (on ? csv(draft.tags).filter((x) => x !== t) : [...csv(draft.tags), t]).join(',') })}>{t}</button>;
              })}</div></div>
            <div className="field"><label htmlFor="cp-sub">Subject</label>
              <input id="cp-sub" ref={subject} className="input" value={draft.subject} onFocus={() => { last.current = 'subject'; }} onChange={(e) => edit({ subject: e.target.value })} />
              {kind === 'followup' && <span className="help">Follow-ups reply in the same thread, so the thread's subject is used.</span>}</div>
            <div className="field"><label>Body</label>
              <RichText ref={body} value={draft.body_html} links={globalLinks.map((l) => ({ key: l.key, label: l.label }))} onFocus={() => { last.current = 'body'; }}
                onChange={(html) => edit({ body_html: html })} placeholder="Write the email. Insert variables and links with the chips below." />
              <div className="chips" style={{ marginTop: 10 }} aria-label="Variables">
                {VARIABLES.map((v) => <button key={v} type="button" className="chip" onMouseDown={(e) => e.preventDefault()} onClick={() => insertVar(`{{${v}}}`)}>{`{{${v}}}`}</button>)}
              </div>
              {globalLinks.length > 0 && (
                <div className="chips" style={{ marginTop: 8 }} aria-label="Links">
                  {globalLinks.map((l) => <button key={l.id} type="button" className="chip" onMouseDown={(e) => e.preventDefault()} onClick={() => insertVar(`{{link:${l.key}}}`)}>{l.label}</button>)}
                </div>
              )}
            </div>
            <div className="field-row">
              <div className="field"><label htmlFor="cp-sig">Signature</label>
                <select id="cp-sig" className="select" value={draft.signature_id} onChange={(e) => edit({ signature_id: e.target.value })}>
                  <option value="">Default</option>
                  {d.signatures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  <option value="none">None</option>
                </select></div>
              <div className="field"><label>Links</label>
                <label className="row small"><input type="checkbox" className="checkbox" checked={draft.auto_link} onChange={(e) => edit({ auto_link: e.target.checked })} />Auto-link words</label>
                <span className="help">The first mention of a link's words becomes a link.</span></div>
            </div>
            <div className="field"><label htmlFor="cp-img">Image URL</label><input id="cp-img" className="input" value={draft.image_url} onChange={(e) => edit({ image_url: e.target.value })} placeholder="https://…/email/image.png" />
              <span className="help">Host images in web/public/email/ and paste the full URL.</span></div>

            <div className="row">
              {!draft.id ? <button className="btn primary" disabled={!draft.name.trim()} onClick={create}>Create {noun}</button> : (
                <>
                  <button className="btn" onClick={() => duplicate(draft)}>Duplicate</button>
                  <button className="btn" onClick={() => archive(draft)}>{draft.archived ? 'Restore' : 'Archive'}</button>
                  <SavedHint show={!dirty && !!savedAt} />
                </>
              )}
            </div>

            <div className="field"><label>Preview, with a sample contact</label>
              <div className="small muted" style={{ marginBottom: 6 }}>Subject: <b style={{ fontWeight: 500, color: 'var(--text)' }}>{rendered?.subject || '(empty)'}</b></div>
              <iframe title="Email preview" className="email-frame" sandbox="" srcDoc={iframeDoc(rendered?.html || '')} />
              {emptyLinks.map((m) => (
                <div key={m} className="warn" style={{ marginTop: 6 }}><AlertTriangle {...iconProps} />{`{{${m}}}`} has no URL yet. Fill it in on the Links tab. Emails using it will not send.</div>
              ))}
              {unknownVars.length > 0 && <div className="help">Unknown variables: {unknownVars.join(', ')}.</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Links ----------

const blankLink = (): Link => ({ id: '', label: '', url: '', key: '', auto_words: '', is_primary: false, scope: 'global', company_id: '', contact_id: '', created_at: '' });

function LinksTab({ req }: { req: number }) {
  const d = useData();
  const { mutate, savedAt } = useStore();
  const [draft, setDraft] = useState<Link | null>(null);
  const [keyTouched, setKeyTouched] = useState(false);
  const [dirty, setDirty] = useState(false);
  useCreateRequest(req, () => { setDraft({ ...blankLink(), id: uid() }); setKeyTouched(false); setDirty(false); });

  const list = d.links.filter((l) => l.scope === 'global').sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.label.localeCompare(b.label));
  const exists = (id: string) => d.links.some((l) => l.id === id);

  const persist = useDebounced((l: Link) => {
    if (!l.label.trim()) return;
    mutate('saveLink', { link: l }, (x) => {
      const row = { ...l, key: l.key || slug(l.label) };
      const rest = x.links.map((o) => (l.is_primary && o.scope === 'global' && o.id !== l.id ? { ...o, is_primary: false } : o));
      return { ...x, links: exists(l.id) ? rest.map((o) => (o.id === l.id ? { ...o, ...row } : o)) : [...rest, row] };
    }).then(() => setDirty(false));
  }, 700);

  const edit = (patch: Partial<Link>, fromLabel = false) => {
    if (!draft) return;
    const next = { ...draft, ...patch };
    if (fromLabel && !keyTouched && !exists(draft.id)) next.key = slug(next.label);
    setDraft(next);
    setDirty(true);
    persist(next);
  };

  const remove = (l: Link) => {
    if (!window.confirm(`Delete the link "${l.label}"? Emails that use it will stop sending until you fix them.`)) return;
    mutate('deleteLink', { id: l.id }, (x) => ({ ...x, links: x.links.filter((o) => o.id !== l.id) }));
    setDraft(null);
  };

  return (
    <div className="copy-layout">
      <div>
        {!list.length && !draft && <div className="empty"><p>No links yet.</p><button className="link-btn" onClick={() => { setDraft({ ...blankLink(), id: uid() }); setKeyTouched(false); }}>New link</button></div>}
        {list.map((l) => (
          <button key={l.id} className={`copy-item ${draft?.id === l.id ? 'active' : ''}`} onClick={() => { setDraft({ ...l }); setKeyTouched(true); setDirty(false); }}>
            <div className="row"><span className="nm grow trunc">{l.label}</span>{l.is_primary && <span className="pill tone-yellow">Primary</span>}</div>
            <div className="xs faint trunc">{l.url || 'No URL yet'} · {`{{link:${l.key}}}`}</div>
          </button>
        ))}
      </div>
      <div>
        {!draft ? <p className="muted">Select a link to edit it.</p> : (
          <div className="col" style={{ gap: 20 }}>
            <div className="field-row">
              <div className="field"><label htmlFor="ln-label">Label</label><input id="ln-label" className="input" value={draft.label} onChange={(e) => edit({ label: e.target.value }, true)} placeholder="Portfolio" /></div>
              <div className="field"><label htmlFor="ln-key">Key</label><input id="ln-key" className="input" value={draft.key} onChange={(e) => { setKeyTouched(true); edit({ key: slug(e.target.value) }); }} placeholder="portfolio" />
                <span className="help">Used as {`{{link:${draft.key || 'key'}}}`}.</span></div>
            </div>
            <div className="field"><label htmlFor="ln-url">URL</label><input id="ln-url" className="input" value={draft.url} onChange={(e) => edit({ url: e.target.value })} placeholder="https://" />
              {!draft.url && <div className="warn"><AlertTriangle {...iconProps} />No URL yet. Emails that use this link will not send until you add one.</div>}</div>
            <div className="field"><label htmlFor="ln-words">Auto-link words</label><input id="ln-words" className="input" value={draft.auto_words} onChange={(e) => edit({ auto_words: e.target.value })} placeholder="portfolio, my work" />
              <span className="help">Comma separated. The first whole-word match in an email becomes this link.</span></div>
            <label className="row small"><input type="checkbox" className="checkbox" checked={draft.is_primary} onChange={(e) => edit({ is_primary: e.target.checked })} />Primary link, pinned at the top</label>
            <div className="row">
              {exists(draft.id) && <button className="btn danger" onClick={() => remove(draft)}>Delete</button>}
              <SavedHint show={!dirty && !!savedAt && exists(draft.id)} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Signatures ----------

const blankSig = (): Signature => ({ id: '', name: '', html: '', image_url: '', is_default: false, updated_at: '' });

function SignaturesTab({ req }: { req: number }) {
  const d = useData();
  const { mutate, savedAt } = useStore();
  const [draft, setDraft] = useState<Signature | null>(null);
  const [dirty, setDirty] = useState(false);
  useCreateRequest(req, () => { setDraft({ ...blankSig(), id: uid() }); setDirty(false); });

  const exists = (id: string) => d.signatures.some((s) => s.id === id);
  const links = useMemo(() => resolveLinks(d), [d.links]); // eslint-disable-line react-hooks/exhaustive-deps

  const persist = useDebounced((g: Signature) => {
    if (!g.name.trim()) return;
    mutate('saveSignature', { signature: g }, (x) => {
      const rest = x.signatures.map((o) => (g.is_default && o.id !== g.id ? { ...o, is_default: false } : o));
      return { ...x, signatures: exists(g.id) ? rest.map((o) => (o.id === g.id ? { ...o, ...g } : o)) : [...rest, g] };
    }).then(() => setDirty(false));
  }, 700);

  const edit = (patch: Partial<Signature>) => {
    if (!draft) return;
    const next = { ...draft, ...patch };
    setDraft(next);
    setDirty(true);
    persist(next);
  };

  const remove = (g: Signature) => {
    if (!window.confirm(`Delete the signature "${g.name}"? Emails using it fall back to the default.`)) return;
    mutate('deleteSignature', { id: g.id }, (x) => ({ ...x, signatures: x.signatures.filter((o) => o.id !== g.id), copies: x.copies.map((c) => (c.signature_id === g.id ? { ...c, signature_id: '' } : c)) }));
    setDraft(null);
  };

  const vars = { ...SAMPLE, portfolio_url: links.portfolio?.url || '', sender_name: d.settings.sender_name || 'Sehaz' };

  return (
    <div className="copy-layout">
      <div>
        {!d.signatures.length && !draft && <div className="empty"><p>No signatures yet.</p><button className="link-btn" onClick={() => setDraft({ ...blankSig(), id: uid() })}>New signature</button></div>}
        {d.signatures.map((g) => (
          <button key={g.id} className={`copy-item ${draft?.id === g.id ? 'active' : ''}`} onClick={() => { setDraft({ ...g }); setDirty(false); }}>
            <div className="row"><span className="nm grow trunc">{g.name}</span>{g.is_default && <span className="pill tone-yellow">Default</span>}</div>
          </button>
        ))}
      </div>
      <div>
        {!draft ? <p className="muted">Select a signature to edit it.</p> : (
          <div className="col" style={{ gap: 20 }}>
            <div className="field"><label htmlFor="sg-name">Name</label><input id="sg-name" className="input" value={draft.name} onChange={(e) => edit({ name: e.target.value })} placeholder="Simple" /></div>
            <div className="field"><label htmlFor="sg-html">HTML</label>
              <textarea id="sg-html" className="textarea" style={{ minHeight: 180, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13 }} value={draft.html}
                onChange={(e) => edit({ html: e.target.value })} placeholder={'<div>{{sender_name}}<br>{{link:portfolio}}</div>'} />
              <span className="help">Variables and {'{{link:key}}'} work here too.</span></div>
            <div className="field"><label htmlFor="sg-img">Image URL</label><input id="sg-img" className="input" value={draft.image_url} onChange={(e) => edit({ image_url: e.target.value })} placeholder="https://" /></div>
            <label className="row small"><input type="checkbox" className="checkbox" checked={draft.is_default} onChange={(e) => edit({ is_default: e.target.checked })} />Use as the default signature</label>
            <div className="row">
              {exists(draft.id) && <button className="btn danger" onClick={() => remove(draft)}>Delete</button>}
              <SavedHint show={!dirty && !!savedAt && exists(draft.id)} />
            </div>
            <div className="field"><label>Preview</label>
              <iframe title="Signature preview" className="email-frame" sandbox="" style={{ height: 200 }} srcDoc={iframeDoc(renderSignature(draft, vars, links))} /></div>
          </div>
        )}
      </div>
    </div>
  );
}
