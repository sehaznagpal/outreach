import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData, useStore } from '../store';
import { Empty, RichText, Seg, useDebounced, type RichHandle, SavedHint } from '../components/ui';
import { iframeDoc, renderCopy, SAMPLE, VARIABLES } from '../lib/render';
import { fmtShort, dateOf } from '../lib/dates';
import { csv, type Copy } from '../types';

const TAGS = ['text', 'links', 'opening', 'signature', 'image'];
const BLANK: Copy = { id: '', name: '', kind: 'first', tags: '', subject: '', body_html: '', uses_vars: '', image_url: '', include_signature: true, archived: false, updated_at: '' };

export function Copies() {
  const d = useData();
  const { mutate, savedAt } = useStore();
  const [kind, setKind] = useState<'first' | 'followup'>('first');
  const [showArchived, setShowArchived] = useState(false);
  const [draft, setDraft] = useState<Copy | null>(null);
  const [dirty, setDirty] = useState(false);
  const body = useRef<RichHandle>(null);
  const subject = useRef<HTMLInputElement>(null);
  const last = useRef<'subject' | 'body'>('body');

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

  const insertVar = (v: string) => {
    const text = `{{${v}}}`;
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

  const vars = { ...SAMPLE, portfolio_url: d.settings.portfolio_url || 'https://portfolio.example', sender_name: d.settings.sender_name || 'Sehaz' };
  const rendered = draft ? renderCopy(draft, vars, d.settings) : null;

  return (
    <>
      <div className="page-head">
        <div><h1 className="page-title">Copies</h1><p className="page-sub">Reusable emails. Pick which ones each company uses on its page.</p></div>
        <button className="btn primary" onClick={() => { setDraft({ ...BLANK, kind }); setDirty(false); }}>New copy</button>
      </div>

      <div className="copy-layout">
        <div>
          <div className="row" style={{ marginBottom: 14, justifyContent: 'space-between' }}>
            <Seg label="Kind" value={kind} onChange={setKind} options={[{ value: 'first', label: 'First emails' }, { value: 'followup', label: 'Follow-ups' }]} />
            <label className="row small muted"><input type="checkbox" className="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />Archived</label>
          </div>
          {!list.length && <Empty text={`No ${kind === 'first' ? 'first-email' : 'follow-up'} copies yet.`} action="New copy" onAction={() => setDraft({ ...BLANK, kind })} />}
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
          {!draft ? <Empty text="Pick a copy to edit, or start a new one." action="New copy" onAction={() => setDraft({ ...BLANK, kind })} /> : (
            <div className="col" style={{ gap: 20 }}>
              <div className="field-row">
                <div className="field"><label htmlFor="cp-name">Name</label><input id="cp-name" className="input" value={draft.name} onChange={(e) => edit({ name: e.target.value })} /></div>
                <div className="field"><label>Kind</label>
                  <Seg label="Copy kind" value={draft.kind} onChange={(v) => edit({ kind: v })} options={[{ value: 'first', label: 'First email' }, { value: 'followup', label: 'Follow-up' }]} /></div>
              </div>
              <div className="field"><label>Tags</label>
                <div className="tagpick">{TAGS.map((t) => {
                  const on = csv(draft.tags).includes(t);
                  return <button key={t} type="button" className={`pill ${on ? 'selected' : ''}`} aria-pressed={on}
                    onClick={() => edit({ tags: (on ? csv(draft.tags).filter((x) => x !== t) : [...csv(draft.tags), t]).join(',') })}>{t}</button>;
                })}</div></div>
              <div className="field"><label htmlFor="cp-sub">Subject</label>
                <input id="cp-sub" ref={subject} className="input" value={draft.subject} onFocus={() => { last.current = 'subject'; }} onChange={(e) => edit({ subject: e.target.value })} />
                {draft.kind === 'followup' && <span className="help">Follow-ups reply in the same thread, so the thread's subject is used.</span>}</div>
              <div className="field"><label>Body</label>
                <RichText ref={body} value={draft.body_html} onFocus={() => { last.current = 'body'; }} onChange={(html) => edit({ body_html: html })} placeholder="Write the email. Insert variables with the chips below." />
                <div className="chips" style={{ marginTop: 10 }} aria-label="Variables">
                  {VARIABLES.map((v) => <button key={v} type="button" className="chip" onMouseDown={(e) => e.preventDefault()} onClick={() => insertVar(v)}>{`{{${v}}}`}</button>)}
                </div></div>
              <div className="field-row">
                <div className="field"><label htmlFor="cp-img">Image URL</label><input id="cp-img" className="input" value={draft.image_url} onChange={(e) => edit({ image_url: e.target.value })} placeholder="https://…/email/image.png" />
                  <span className="help">Host images in web/public/email/ and paste the full URL.</span></div>
                <div className="field"><label>Signature</label>
                  <label className="row small"><input type="checkbox" className="checkbox" checked={draft.include_signature} onChange={(e) => edit({ include_signature: e.target.checked })} />Include signature <Link to="/settings" className="muted" style={{ textDecoration: 'underline' }}>(edit in Settings)</Link></label></div>
              </div>

              <div className="row">
                {!draft.id ? <button className="btn primary" disabled={!draft.name.trim()} onClick={create}>Create copy</button> : (
                  <>
                    <button className="btn" onClick={() => duplicate(draft)}>Duplicate</button>
                    <button className="btn" onClick={() => archive(draft)}>{draft.archived ? 'Restore' : 'Archive'}</button>
                    <SavedHint show={!dirty && !!savedAt} />
                  </>
                )}
              </div>

              <div className="field"><label>Live preview, with a sample contact</label>
                <div className="small muted" style={{ marginBottom: 6 }}>Subject: <b style={{ fontWeight: 500, color: 'var(--text)' }}>{rendered?.subject || '(empty)'}</b></div>
                <iframe title="Copy preview" className="email-frame" sandbox="" srcDoc={iframeDoc(rendered?.html || '')} />
                {rendered && rendered.missing.length > 0 && <div className="help">Unknown variables: {rendered.missing.filter((m) => !(VARIABLES as readonly string[]).includes(m)).join(', ') || 'none'}.</div>}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
