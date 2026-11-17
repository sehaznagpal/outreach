import { useRef, useState } from 'react';
import { uid, useData, useStore } from '../store';
import { resolveLinks, VARIABLES } from '../lib/render';
import { nowIso } from '../lib/dates';
import { Modal, RichText, type RichHandle } from './ui';
import type { Company, Copy } from '../types';

/** A copy written for one company only. Hidden from Content; used instead of the shared copies. */
export function CustomCopy({ company, kind, copy, chosen, field, saveCompany, onClose }: {
  company: Company; kind: 'first' | 'followup'; copy: Copy | null; chosen: string[];
  field: 'copy_ids' | 'followup_copy_ids'; saveCompany: (p: Partial<Company>) => void; onClose: () => void;
}) {
  const d = useData();
  const { mutate } = useStore();
  const body = useRef<RichHandle>(null);
  const [from, setFrom] = useState('');
  const [subject, setSubject] = useState(copy?.subject || '');
  const [html, setHtml] = useState(copy?.body_html || '');
  const [sig, setSig] = useState(copy?.signature_id || '');
  const shared = d.copies.filter((c) => c.kind === kind && !c.archived && !c.company_id);
  const links = Object.values(resolveLinks(d, company.id));

  const startFrom = (id: string) => {
    setFrom(id);
    const c = d.copies.find((x) => x.id === id);
    if (c) { setSubject(c.subject); setHtml(c.body_html); setSig(c.signature_id); }
  };

  const save = async () => {
    const row: Copy = {
      id: copy?.id || uid(), name: `Custom: ${company.name}`, kind, tags: 'custom', subject, body_html: html, uses_vars: '',
      image_url: copy?.image_url || '', signature_id: sig, auto_link: copy?.auto_link ?? true, archived: false, updated_at: nowIso(), company_id: company.id,
    };
    await mutate('saveCopy', { copy: row }, (x) => ({
      ...x, copies: x.copies.some((c) => c.id === row.id) ? x.copies.map((c) => (c.id === row.id ? row : c)) : [...x.copies, row],
    }));
    // a new custom copy replaces the shared ones for this company, so only it is used
    if (!copy) saveCompany({ [field]: row.id });
    else if (!chosen.includes(row.id)) saveCompany({ [field]: [...chosen, row.id].join(',') });
    onClose();
  };

  return (
    <Modal title={`${copy ? 'Edit' : 'Write'} a custom ${kind === 'first' ? 'email' : 'follow-up'} for ${company.name}`} onClose={onClose} wide>
      <div className="col" style={{ gap: 16 }}>
        {!copy && shared.length > 0 && (
          <div className="field"><label htmlFor="cc-from">Start from</label>
            <select id="cc-from" className="select" value={from} onChange={(e) => startFrom(e.target.value)}>
              <option value="">A blank email</option>
              {shared.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
        )}
        <div className="field"><label htmlFor="cc-sub">Subject</label>
          <input id="cc-sub" className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
          {kind === 'followup' && <span className="help">Follow-ups reply in the same thread, so the thread's subject is used.</span>}</div>
        <div className="field"><label>Body</label>
          <RichText ref={body} value={html} links={links.map((l) => ({ key: l.key, label: l.label }))} onChange={setHtml} placeholder="Write the email for this company." />
          <div className="chips" style={{ marginTop: 10 }} aria-label="Variables">
            {VARIABLES.map((v) => <button key={v} type="button" className="chip" onMouseDown={(e) => e.preventDefault()} onClick={() => body.current?.insert(`{{${v}}}`)}>{`{{${v}}}`}</button>)}
          </div>
        </div>
        <div className="field"><label htmlFor="cc-sig">Signature</label>
          <select id="cc-sig" className="select" value={sig} onChange={(e) => setSig(e.target.value)}>
            <option value="">Default</option>
            {d.signatures.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            <option value="none">None</option>
          </select></div>
        {!copy && <p className="help">This will be the only {kind === 'first' ? 'email' : 'follow-up'} used for {company.name}. You can add shared ones back afterwards.</p>}
        <div className="row"><button className="btn primary" disabled={!subject.trim() && kind === 'first'} onClick={() => void save()}>Save</button>
          <button className="btn ghost" onClick={onClose}>Cancel</button></div>
      </div>
    </Modal>
  );
}
