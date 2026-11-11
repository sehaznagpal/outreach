import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, Plus, X } from 'lucide-react';
import { call } from '../api';
import { uid, useData, useStore } from '../store';
import { csv, type Company, type CompanyStatus, type Data, type Rendered } from '../types';
import { Combo, CompanyStatusPill, Empty, iconProps, SavedHint, Seg, useDebounced } from '../components/ui';
import { LinksEditor } from '../components/LinksEditor';
import { PeopleTable } from '../components/PeopleTable';
import { iframeDoc, missingForCompany, resolveLinks } from '../lib/render';
import { dateOf, fmtDay, timeOf } from '../lib/dates';

/** Text input that keeps its own draft and saves on blur. */
function Field({ label, value, onSave, placeholder, id, multiline }: { label: string; value: string | number | null; onSave: (v: string) => void; placeholder?: string; id: string; multiline?: boolean }) {
  const str = value === null || value === undefined ? '' : String(value);
  const [v, setV] = useState(str);
  const [focus, setFocus] = useState(false);
  if (!focus && v !== str) setV(str);
  const common = {
    id, value: v, placeholder, onFocus: () => setFocus(true), onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => setV(e.target.value),
    onBlur: () => { setFocus(false); if (v.trim() !== str) onSave(v.trim()); },
  };
  return (
    <div className="field"><label htmlFor={id}>{label}</label>
      {multiline ? <textarea className="textarea" {...common} /> : <input className="input" {...common} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />}
    </div>
  );
}

export function CompanyPage() {
  const { id = '' } = useParams();
  const d = useData();
  const { mutate, savedAt } = useStore();
  const nav = useNavigate();
  const company = d.companies.find((c) => c.id === id);

  if (!company) return <Empty text="This company no longer exists." action="Back to companies" onAction={() => nav('/companies')} />;

  const saveCompany = (p: Partial<Company>) =>
    mutate('saveCompany', { company: { id: company.id, ...p } }, (x) => ({ ...x, companies: x.companies.map((c) => (c.id === company.id ? { ...c, ...p } : c)) }));

  const markReplied = async () => {
    const who = window.prompt('Who replied? Leave blank if you are not sure. Outreach to this company stops straight away.', '');
    if (who === null) return;
    const match = d.contacts.find((c) => c.company_id === company.id && c.name.toLowerCase() === who.trim().toLowerCase());
    await mutate('markCompanyReplied', { company_id: company.id, contact_id: match?.id, who: who.trim() || undefined });
  };
  const resume = async () => {
    if (!window.confirm('Resume outreach? The company goes back to active and stopped people become drafts. Cancelled batches are not restored, so mark people as ready again.')) return;
    await mutate('resumeCompany', { company_id: company.id });
  };

  const contacts = d.contacts.filter((c) => c.company_id === company.id).sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  const lines = d.lines.filter((l) => l.company_id === company.id);

  return (
    <>
      <div style={{ marginBottom: 32 }}>
        <input className="co-name" aria-label="Company name" defaultValue={company.name} key={company.id + company.name}
          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== company.name) saveCompany({ name: v }); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} placeholder="Company name" />
        <div className="row wrap" style={{ marginTop: 14 }}>
          <input className="input bare" style={{ width: 170, border: '1px solid var(--line-strong)', borderRadius: 999, height: 28 }} aria-label="Industry" placeholder="Industry" defaultValue={company.industry}
            key={'i' + company.industry} onBlur={(e) => e.target.value.trim() !== company.industry && saveCompany({ industry: e.target.value.trim() })} />
          <input className="input bare" style={{ width: 200, height: 28 }} aria-label="Domain" placeholder="domain.com" defaultValue={company.domain}
            key={'d' + company.domain} onBlur={(e) => e.target.value.trim() !== company.domain && saveCompany({ domain: e.target.value.trim() })} />
          <span className="spacer" />
          {company.status === 'replied' ? <CompanyStatusPill status="replied" /> : (
            <>
              <button className="btn sm ghost" onClick={markReplied}>Mark as replied</button>
              <Seg<CompanyStatus> label="Status" value={company.status} onChange={(v) => saveCompany({ status: v })}
                options={[{ value: 'active', label: 'Active' }, { value: 'paused', label: 'Paused' }, { value: 'done', label: 'Done' }]} />
            </>
          )}
        </div>
      </div>

      {company.status === 'replied' && (
        <div className="banner stop" role="status">
          <span className="grow"><b style={{ fontWeight: 500 }}>{company.replied_by || 'Someone'}</b> replied on {company.replied_at ? fmtDay(dateOf(company.replied_at)) : 'an earlier date'}. Outreach to this company is stopped.</span>
          <button className="btn sm" onClick={resume}>Resume outreach</button>
        </div>
      )}

      <div className="co-layout">
        <div>
          <section>
            <div className="section-head"><h2>People</h2><span className="small faint">{contacts.length}</span></div>
            <PeopleTable company={company} contacts={contacts} />
          </section>
          <LinesSection company={company} lines={lines} />
          <NotesSection company={company} onSave={(notes) => saveCompany({ notes })} saved={!!savedAt} />
        </div>
        <Sidebar company={company} d={d} saveCompany={saveCompany} />
      </div>
    </>
  );
}

// ---------- lines ----------

function LinesSection({ company, lines }: { company: Company; lines: Data['lines'] }) {
  const { mutate } = useStore();
  const [adding, setAdding] = useState(false);
  const persist = (next: Array<{ id: string; text: string }>) =>
    mutate('saveLines', { company_id: company.id, lines: next }, (x) => ({
      ...x, lines: [...x.lines.filter((l) => l.company_id !== company.id), ...next.filter((l) => l.text.trim()).map((l) => ({ id: l.id, company_id: company.id, text: l.text.trim() }))],
    }));
  const cur = lines.map((l) => ({ id: l.id, text: l.text }));

  return (
    <section className="section">
      <div className="section-head"><h2>Lines</h2>
        {lines.length < 5 && !adding && <button className="btn sm" onClick={() => setAdding(true)}><Plus {...iconProps} />Add a line</button>}
      </div>
      {!lines.length && !adding && <Empty text="Write one to five personal lines about this company. They fill {{line}} in your copies." action="Add a line" onAction={() => setAdding(true)} />}
      <div className="col" style={{ gap: 8 }}>
        {lines.map((l) => (
          <div key={l.id} className="line-item">
            <textarea className="textarea" aria-label="Line" defaultValue={l.text} rows={1} style={{ height: 'auto', minHeight: 40 }}
              onBlur={(e) => { const t = e.target.value.trim(); if (t !== l.text) persist(cur.map((x) => (x.id === l.id ? { ...x, text: t } : x))); }} />
            <button className="icon-btn" aria-label="Delete line" onClick={() => persist(cur.filter((x) => x.id !== l.id))}><X {...iconProps} /></button>
          </div>
        ))}
        {adding && (
          <div className="line-item">
            <textarea className="textarea" aria-label="New line" autoFocus rows={1} placeholder="e.g. I liked how your onboarding explains pricing up front."
              onBlur={(e) => { const t = e.target.value.trim(); setAdding(false); if (t) persist([...cur, { id: uid(), text: t }]); }} />
          </div>
        )}
      </div>
      {lines.length > 0 && <p className="help" style={{ marginTop: 10 }}>Each person gets one at random. Override per person in the table.</p>}
    </section>
  );
}

// ---------- notes ----------

function NotesSection({ company, onSave, saved }: { company: Company; onSave: (v: string) => void; saved: boolean }) {
  const [v, setV] = useState(company.notes);
  const [dirty, setDirty] = useState(false);
  const save = useDebounced((x: string) => { onSave(x); setDirty(false); }, 800);
  useEffect(() => { setV(company.notes); setDirty(false); }, [company.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="section">
      <div className="section-head"><h2>Notes</h2><SavedHint show={!dirty && saved} /></div>
      <textarea className="textarea" style={{ minHeight: 140 }} aria-label="Notes" value={v} placeholder="Anything worth remembering about this company."
        onChange={(e) => { setV(e.target.value); setDirty(true); save(e.target.value); }} />
    </section>
  );
}

// ---------- sidebar ----------

function CopyPicker({ title, kind, max, company, d, field, saveCompany }: {
  title: string; kind: 'first' | 'followup'; max: number; company: Company; d: Data; field: 'copy_ids' | 'followup_copy_ids'; saveCompany: (p: Partial<Company>) => void;
}) {
  const chosen = csv(company[field]);
  const hasLines = d.lines.some((l) => l.company_id === company.id);
  const links = resolveLinks(d, company.id);
  const options = d.copies.filter((c) => c.kind === kind && !c.archived && !chosen.includes(c.id)).map((c) => ({ value: c.id, label: c.name, hint: csv(c.tags).join(' · ') }));
  return (
    <div className="field" style={{ marginBottom: 18 }}>
      <label>{title} <span className="faint">({chosen.length}/{max})</span></label>
      <div className="chosen">
        {chosen.map((cid) => {
          const cp = d.copies.find((c) => c.id === cid);
          if (!cp) return null;
          const miss = missingForCompany(cp, company, d.settings, hasLines, links, d.signatures);
          return (
            <div key={cid}>
              <div className="chosen-item"><span className="trunc">{cp.name}</span>
                <button className="icon-btn" style={{ width: 24, height: 24 }} aria-label={`Remove ${cp.name}`} onClick={() => saveCompany({ [field]: chosen.filter((x) => x !== cid).join(',') })}><X size={14} strokeWidth={1.5} /></button></div>
              {miss.length > 0 && <div className="warn" style={{ marginTop: 4 }}><AlertTriangle {...iconProps} />Uses {miss.map((m) => `{{${m}}}`).join(', ')}, which is not filled in.</div>}
            </div>
          );
        })}
      </div>
      {chosen.length < max && (options.length
        ? <Combo value="" options={options} placeholder={`Add a ${kind === 'first' ? 'copy' : 'follow-up copy'}`} onChange={(v) => v && saveCompany({ [field]: [...chosen, v].join(',') })} />
        : <p className="help">No {kind === 'first' ? 'copies' : 'follow-up copies'} to add. <Link to="/copies" style={{ textDecoration: 'underline' }}>Write one in Copies.</Link></p>)}
      {kind === 'first' && chosen.length === 0 && <div className="warn"><AlertTriangle {...iconProps} />Pick at least one copy before marking people ready.</div>}
    </div>
  );
}

function Sidebar({ company, d, saveCompany }: { company: Company; d: Data; saveCompany: (p: Partial<Company>) => void }) {
  const { toast, savedAt } = useStore();
  const nav = useNavigate();
  const { mutate } = useStore();
  const people = d.contacts.filter((c) => c.company_id === company.id);
  const [pid, setPid] = useState('');
  const [prev, setPrev] = useState<Rendered | null>(null);
  const [err, setErr] = useState('');
  const [sending, setSending] = useState(false);
  const cur = people.find((p) => p.id === pid) || people[0];
  const seq = useRef(0);

  useEffect(() => {
    if (!cur) { setPrev(null); return; }
    const n = ++seq.current;
    const t = setTimeout(() => {
      call<Rendered>('previewEmail', { contact_id: cur.id }).then((r) => { if (n === seq.current) { setPrev(r); setErr(''); } })
        .catch((e) => { if (n === seq.current) { setPrev(null); setErr(e.message); } });
    }, 400);
    return () => clearTimeout(t);
  }, [cur?.id, savedAt, company.copy_ids]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendTest = async () => {
    if (!cur) return;
    setSending(true);
    try {
      const r = await call<{ sent_to: string }>('sendTest', { contact_id: cur.id });
      toast('ok', `Test sent to ${r.sent_to}.`);
    } catch (e) { toast('error', (e as Error).message); } finally { setSending(false); }
  };

  const planned = d.batches.filter((b) => b.company_id === company.id && b.status === 'planned').sort((a, b) => (a.scheduled_at < b.scheduled_at ? -1 : 1));
  const num = (v: string): number | null => (v === '' ? null : Number(v));

  return (
    <aside className="card" style={{ padding: 28 }} aria-label="Company settings">
      <div className="side-block">
        <h3>Emails for this company</h3>
        <CopyPicker title="First emails" kind="first" max={3} company={company} d={d} field="copy_ids" saveCompany={saveCompany} />
        <CopyPicker title="Follow-ups" kind="followup" max={2} company={company} d={d} field="followup_copy_ids" saveCompany={saveCompany} />
      </div>

      <div className="side-block">
        <h3>Details used in copies</h3>
        <div className="col" style={{ gap: 14 }}>
          <Field id="f-ot" label="Opening title" value={company.opening_title} onSave={(v) => saveCompany({ opening_title: v })} placeholder="Senior Product Designer" />
          <Field id="f-ou" label="Opening URL" value={company.opening_url} onSave={(v) => saveCompany({ opening_url: v })} placeholder="https://" />
          <Field id="f-pp" label="Pitch page URL" value={company.pitch_page_url} onSave={(v) => saveCompany({ pitch_page_url: v })} placeholder="https://" />
          <Field id="f-ep" label="Email pattern" value={company.email_pattern} onSave={(v) => saveCompany({ email_pattern: v })} placeholder="{first}.{last}@domain" />
          <span className="help" style={{ marginTop: -8 }}>Fills emails as you type names. Tokens: {'{first}'} {'{last}'} {'{f}'} {'{l}'}.</span>
        </div>
      </div>

      <div className="side-block">
        <h3>Links for this company</h3>
        <LinksEditor scope="company" companyId={company.id} />
        <p className="help" style={{ marginTop: 8 }}>Use them as {'{{link:key}}'} in this company's emails, or through auto-link words.</p>
      </div>

      <div className="side-block">
        <h3>Sending rules</h3>
        <div className="col" style={{ gap: 14 }}>
          <Field id="f-bs" label="Batch size" value={company.batch_size} onSave={(v) => saveCompany({ batch_size: num(v) ?? 4 })} />
          <Field id="f-fd" label={`Follow up after (days). Default ${d.settings.followup_after_days}`} value={company.followup_after_days} onSave={(v) => saveCompany({ followup_after_days: num(v) })} placeholder="Use default" />
          <Field id="f-mf" label={`Max follow-ups. Default ${d.settings.max_followups}`} value={company.max_followups} onSave={(v) => saveCompany({ max_followups: num(v) })} placeholder="Use default" />
        </div>
      </div>

      <div className="side-block">
        <h3>Preview</h3>
        {!people.length ? <p className="help">Add a person to preview the email.</p> : (
          <div className="col" style={{ gap: 12 }}>
            <Combo value={cur?.id || ''} options={people.map((p) => ({ value: p.id, label: p.name, hint: p.role }))} onChange={setPid} />
            {err && <div className="warn"><AlertTriangle {...iconProps} />{err}</div>}
            {prev && (
              <>
                <div className="small muted">To {prev.to || '—'}<br />Subject: <b style={{ fontWeight: 500, color: 'var(--text)' }}>{prev.subject}</b></div>
                {prev.missing.length > 0 && <div className="warn"><AlertTriangle {...iconProps} />Missing {prev.missing.map((m) => `{{${m}}}`).join(', ')}. This will not send until filled.</div>}
                <iframe title="Email preview" className="email-frame" sandbox="" srcDoc={iframeDoc(prev.html)} />
                {prev.links_used && prev.links_used.length > 0 && (
                  <div className="help">Links used: {prev.links_used.map((l) => `${l.label} (${l.level === 'contact' ? 'this person' : l.level})`).join(', ')}</div>
                )}
              </>
            )}
            <button className="btn" onClick={sendTest} disabled={sending || !prev || prev.missing.length > 0}>{sending ? 'Sending' : 'Send test to me'}</button>
          </div>
        )}
      </div>

      <div className="side-block">
        <h3>Planned batches</h3>
        {planned.length ? planned.map((b) => (
          <Link key={b.id} to="/logs" className="attn-item" style={{ justifyContent: 'space-between' }}>
            <span>{fmtDay(dateOf(b.scheduled_at))} · around {timeOf(b.scheduled_at)}</span>
            <span className="muted small">{b.type === 'first' ? 'First' : 'Follow-up'} · {csv(b.contact_ids).length}</span>
          </Link>
        )) : <p className="help">None yet. Mark people ready and they are queued.</p>}
        <p className="help" style={{ marginTop: 8 }}>Change dates in Logs.</p>
      </div>

      <button className="btn ghost danger" onClick={async () => {
        if (!window.confirm(`Delete ${company.name} and all its people? Send history stays.`)) return;
        const res = await mutate('deleteCompany', { id: company.id });
        if (res) nav('/companies');
      }}>Delete company</button>
    </aside>
  );
}
