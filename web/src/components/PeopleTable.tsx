import { useMemo, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useData, useStore, uid } from '../store';
import { csv, type Company, type Contact, type Data } from '../types';
import { Combo, iconProps, Modal, StatusPill, Switch } from './ui';
import { fmtDay, dateOf, timeOf } from '../lib/dates';

// ---------- helpers ----------

export function suggestEmail(pattern: string, name: string, domain: string): string {
  if (!pattern || !name.trim()) return '';
  const parts = name.trim().toLowerCase().replace(/['’.]/g, '').replace(/[^a-z\s-]/g, '').split(/\s+/).filter(Boolean);
  const first = parts[0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1] : '';
  if (!first) return '';
  if (/\{(last|l)\}/.test(pattern) && !last) return '';
  const dom = domain.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  let p = pattern.replace(/\{first\}/g, first).replace(/\{last\}/g, last).replace(/\{f\}/g, first[0]).replace(/\{l\}/g, last[0] || '').replace(/\{domain\}/g, dom);
  if (/@domain\b/.test(p)) p = p.replace(/@domain\b/, '@' + dom);
  if (!p.includes('@')) p += '@' + dom;
  if (!dom && p.endsWith('@')) return '';
  return p;
}

const blankContact = (company_id: string, f: Partial<Contact>): Contact => ({
  id: uid(), company_id, name: '', first_name: '', role: '', email: '', linkedin_url: '', line_override: '', copy_override_id: '',
  status: 'draft', assigned_line: '', assigned_copy_id: '', batch_id: '', thread_id: '', first_sent_at: '', last_sent_at: '',
  followups_sent: 0, replied_at: '', created_at: '', ...f,
});

const upsertContacts = (rows: Contact[]) => (d: Data): Data => {
  const next = [...d.contacts];
  rows.forEach((r) => {
    const i = next.findIndex((c) => c.id === r.id);
    if (i >= 0) next[i] = { ...next[i], ...r }; else next.push(r);
  });
  return { ...d, contacts: next };
};

function useContactActions(company: Company) {
  const { mutate, toast, patch, data } = useStore();
  const save = (rows: Array<Partial<Contact> & { id?: string }>, optimistic: Contact[]) =>
    mutate<{ warnings?: Array<{ email: string; message: string }> }>('saveContacts', { company_id: company.id, contacts: rows }, upsertContacts(optimistic));
  const update = (c: Contact, p: Partial<Contact>) => save([{ id: c.id, ...p }], [{ ...c, ...p }]);
  const setReady = async (ids: string[], ready: boolean) => {
    patch((d) => ({ ...d, contacts: d.contacts.map((c) => (ids.includes(c.id) && (ready ? c.status === 'draft' : ['ready', 'scheduled'].includes(c.status)) ? { ...c, status: ready ? 'ready' : 'draft' } : c)) }));
    const res = await mutate<{ errors: Array<{ contact_id: string; message: string }> }>('setReady', { ids, ready });
    if (!res) return;
    res.errors.forEach((e) => {
      const name = data?.contacts.find((c) => c.id === e.contact_id)?.name || 'Contact';
      toast('error', `${name}: ${e.message}`);
      patch((d) => ({ ...d, contacts: d.contacts.map((c) => (c.id === e.contact_id ? { ...c, status: 'draft' } : c)) }));
    });
  };
  const remove = (ids: string[]) => {
    ids.forEach((id) => mutate('removeContact', { id }, (d) => ({ ...d, contacts: d.contacts.filter((c) => c.id !== id) })));
  };
  return { save, update, setReady, remove };
}

// ---------- table ----------

export function PeopleTable({ company, contacts }: { company: Company; contacts: Contact[] }) {
  const d = useData();
  const { mutate } = useStore();
  const act = useContactActions(company);
  const [sel, setSel] = useState<string[]>([]);
  const [pasting, setPasting] = useState(false);
  const lines = d.lines.filter((l) => l.company_id === company.id);
  const roleOpts = d.roles.map((r) => ({ value: r, label: r }));
  const firstCopies = d.copies.filter((c) => c.kind === 'first' && !c.archived);
  const addRole = async (role: string) => { await mutate('addRole', { role }, (x) => ({ ...x, roles: x.roles.includes(role) ? x.roles : [...x.roles, role] })); };
  const allSel = contacts.length > 0 && sel.length === contacts.length;
  const live = sel.filter((id) => contacts.some((c) => c.id === id));

  return (
    <div>
      {live.length > 0 && (
        <div className="bulkbar" role="toolbar" aria-label="Bulk actions">
          <span className="small">{live.length} selected</span>
          <button className="btn sm" onClick={() => { act.setReady(live, true); setSel([]); }}>Mark ready</button>
          <div style={{ width: 190 }}><Combo value="" options={roleOpts} placeholder="Change role" onAdd={addRole}
            onChange={(v) => { if (v) { act.save(live.map((id) => ({ id, role: v })), contacts.filter((c) => live.includes(c.id)).map((c) => ({ ...c, role: v }))); setSel([]); } }} /></div>
          <button className="btn sm danger" onClick={() => { if (window.confirm(`Remove ${live.length} ${live.length === 1 ? 'person' : 'people'}?`)) { act.remove(live); setSel([]); } }}>Remove</button>
          <span className="spacer" />
          <button className="btn sm ghost" onClick={() => setSel([])}>Clear</button>
        </div>
      )}

      <div className="tbl-wrap">
        <table className="tbl people">
          <colgroup><col style={{ width: 32 }} /><col style={{ width: 150 }} /><col style={{ width: 150 }} /><col style={{ width: 190 }} /><col style={{ width: 100 }} /><col style={{ width: 150 }} /><col style={{ width: 130 }} /><col style={{ width: 110 }} /><col style={{ width: 170 }} /></colgroup>
          <thead>
            <tr>
              <th><input type="checkbox" className="checkbox" aria-label="Select all" checked={allSel} onChange={(e) => setSel(e.target.checked ? contacts.map((c) => c.id) : [])} /></th>
              <th>Name</th><th>Role</th><th>Email</th><th>LinkedIn</th><th>Line</th><th>Copy</th><th>Status</th><th>Action</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((c) => (
              <PersonRow key={c.id} c={c} company={company} d={d} act={act} lines={lines.map((l) => l.text)} roleOpts={roleOpts} addRole={addRole}
                firstCopies={firstCopies} selected={sel.includes(c.id)} toggle={(on) => setSel(on ? [...sel, c.id] : sel.filter((x) => x !== c.id))} />
            ))}
            <NewRow company={company} d={d} act={act} roleOpts={roleOpts} addRole={addRole} />
          </tbody>
        </table>
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn sm" onClick={() => setPasting(true)}>Paste list</button>
        <span className="help">Name, Role, Email per line, or paste rows from a spreadsheet.</span>
      </div>
      {pasting && <PasteModal company={company} d={d} act={act} addRole={addRole} onClose={() => setPasting(false)} />}
    </div>
  );
}

type Act = ReturnType<typeof useContactActions>;

function TextCell({ value, onSave, placeholder, suggestion, label, type }: { value: string; onSave: (v: string) => void; placeholder?: string; suggestion?: string; label: string; type?: string }) {
  const [v, setV] = useState(value);
  const [focus, setFocus] = useState(false);
  if (!focus && v !== value) setV(value);
  return (
    <input className={`input bare ${!v && suggestion ? 'ghost-suggest' : ''}`} aria-label={label} type={type || 'text'} value={v} placeholder={!v && suggestion ? suggestion : placeholder}
      onFocus={() => setFocus(true)} onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Tab' && !e.shiftKey && !v && suggestion) { setV(suggestion); onSave(suggestion); }
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      onBlur={() => { setFocus(false); if (v.trim() !== value) onSave(v.trim()); }} />
  );
}

function PersonRow({ c, company, d, act, lines, roleOpts, addRole, firstCopies, selected, toggle }: {
  c: Contact; company: Company; d: Data; act: Act; lines: string[]; roleOpts: Array<{ value: string; label: string }>;
  addRole: (r: string) => Promise<void>; firstCopies: Data['copies']; selected: boolean; toggle: (on: boolean) => void;
}) {
  const batch = c.batch_id ? d.batches.find((b) => b.id === c.batch_id) : undefined;
  const copyName = d.copies.find((x) => x.id === c.assigned_copy_id)?.name;
  const suggestion = !c.email ? suggestEmail(company.email_pattern, c.name, company.domain) : '';
  const isReady = c.status === 'ready' || c.status === 'scheduled';

  let action: JSX.Element;
  if (c.status === 'draft' || isReady) {
    action = (
      <div className="row" style={{ gap: 10 }}>
        <Switch label={`Ready: ${c.name}`} checked={isReady} onChange={(v) => act.setReady([c.id], v)} />
        <span className="small muted nowrap">{c.status === 'scheduled' && batch ? `Batch · ${fmtDay(dateOf(batch.scheduled_at), { weekday: 'short', day: undefined, month: undefined })} ${timeOf(batch.scheduled_at)}` : c.status === 'ready' ? 'Placing in a batch' : ''}</span>
      </div>
    );
  } else if (c.status === 'sent' || c.status === 'followed_up') {
    const fu = batch && batch.type === 'followup' && batch.status === 'planned' ? `Follow-up ${fmtDay(dateOf(batch.scheduled_at))}` : 'No follow-up queued';
    action = <span className="small muted">Sent {fmtDay(dateOf(c.last_sent_at || c.first_sent_at))}<br /><span className="faint">{c.followups_sent ? `${c.followups_sent} sent · ` : ''}{fu}</span></span>;
  } else if (c.status === 'replied') action = <span className="small muted">Replied {c.replied_at ? fmtDay(dateOf(c.replied_at)) : ''}</span>;
  else action = <span className="small muted">{c.status === 'bounced' ? 'Bounced' : 'Stopped'}</span>;

  return (
    <tr className={selected ? 'selected' : ''}>
      <td><input type="checkbox" className="checkbox" aria-label={`Select ${c.name}`} checked={selected} onChange={(e) => toggle(e.target.checked)} /></td>
      <td><TextCell label="Name" value={c.name} onSave={(v) => v && act.update(c, { name: v, first_name: v.split(/\s+/)[0] })} /></td>
      <td><Combo bare ariaLabel={`Role for ${c.name}`} value={c.role} options={roleOpts} placeholder="Role" onAdd={addRole} addLabel="Add new role" onChange={(v) => act.update(c, { role: v })} /></td>
      <td><TextCell label="Email" type="email" value={c.email} suggestion={suggestion} placeholder="Email" onSave={(v) => act.update(c, { email: v.toLowerCase() })} /></td>
      <td><TextCell label="LinkedIn" value={c.linkedin_url} placeholder="LinkedIn" onSave={(v) => act.update(c, { linkedin_url: v })} /></td>
      <td style={{ maxWidth: 200 }}><Combo bare ariaLabel={`Line for ${c.name}`} value={c.line_override} placeholder={c.assigned_line || 'Random'} clearLabel="Random"
        options={lines.map((l) => ({ value: l, label: l }))} onChange={(v) => act.update(c, { line_override: v })} /></td>
      <td style={{ maxWidth: 180 }}><Combo bare ariaLabel={`Copy for ${c.name}`} value={c.copy_override_id} placeholder={copyName || 'Random'} clearLabel="Random"
        options={firstCopies.map((x) => ({ value: x.id, label: x.name, hint: csv(x.tags).join(' · ') }))} onChange={(v) => act.update(c, { copy_override_id: v })} /></td>
      <td><StatusPill status={c.status} /></td>
      <td>{action}</td>
    </tr>
  );
}

function NewRow({ company, d, act, roleOpts, addRole }: { company: Company; d: Data; act: Act; roleOpts: Array<{ value: string; label: string }>; addRole: (r: string) => Promise<void> }) {
  const [f, setF] = useState({ name: '', role: '', email: '', linkedin_url: '' });
  const [warn, setWarn] = useState('');
  const [ack, setAck] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const roleCell = useRef<HTMLTableCellElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  const suggestion = suggestEmail(company.email_pattern, f.name, company.domain);

  const commit = async () => {
    if (!f.name.trim()) return;
    const email = (f.email || '').trim().toLowerCase();
    const dup = email ? d.contacts.find((c) => c.email.toLowerCase() === email) : undefined;
    if (dup && !ack) {
      const where = d.companies.find((x) => x.id === dup.company_id)?.name || 'another company';
      setWarn(`${email} is already in the database (${dup.name}, ${where}). Press Enter again to add anyway.`);
      setAck(true);
      return;
    }
    const row = blankContact(company.id, { name: f.name.trim(), first_name: f.name.trim().split(/\s+/)[0], role: f.role, email, linkedin_url: f.linkedin_url.trim() });
    setF({ name: '', role: '', email: '', linkedin_url: '' });
    setWarn(''); setAck(false);
    nameRef.current?.focus();
    await act.save([row], [row]);
  };
  const next = (e: React.KeyboardEvent, go: () => void) => {
    if (e.key === 'Enter') { e.preventDefault(); if (e.metaKey || e.ctrlKey) void commit(); else go(); }
  };
  const edit = (p: Partial<typeof f>) => { setF({ ...f, ...p }); if (ack) { setAck(false); setWarn(''); } };

  return (
    <>
      <tr className="newrow">
        <td />
        <td><input ref={nameRef} className="input bare" aria-label="New person name" placeholder="Add a person" value={f.name} onChange={(e) => edit({ name: e.target.value })}
          onKeyDown={(e) => next(e, () => { const b = roleCell.current?.querySelector('button'); b?.focus(); b?.click(); })} /></td>
        <td ref={roleCell}><Combo bare ariaLabel="New person role" value={f.role} options={roleOpts} placeholder="Role" onAdd={async (r) => { await addRole(r); edit({ role: r }); }} addLabel="Add new role"
          onChange={(v) => { edit({ role: v }); setTimeout(() => emailRef.current?.focus(), 0); }} /></td>
        <td><input ref={emailRef} type="email" className={`input bare ${!f.email && suggestion ? 'ghost-suggest' : ''}`} aria-label="New person email" placeholder={suggestion || 'Email'} value={f.email}
          onChange={(e) => edit({ email: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Tab' && !e.shiftKey && !f.email && suggestion) setF({ ...f, email: suggestion }); next(e, () => linkRef.current?.focus()); }} /></td>
        <td><input ref={linkRef} className="input bare" aria-label="New person LinkedIn" placeholder="LinkedIn" value={f.linkedin_url} onChange={(e) => edit({ linkedin_url: e.target.value })} onKeyDown={(e) => next(e, () => void commit())} /></td>
        <td colSpan={4}><button className="btn sm ghost" onClick={() => void commit()} disabled={!f.name.trim()}>Add</button></td>
      </tr>
      {warn && <tr><td /><td colSpan={8}><div className="warn"><AlertTriangle {...iconProps} />{warn}</div></td></tr>}
    </>
  );
}

// ---------- paste list ----------

interface Parsed { name: string; role: string; email: string; linkedin_url: string; dup: string; newRole: boolean }

function PasteModal({ company, d, act, addRole, onClose }: { company: Company; d: Data; act: Act; addRole: (r: string) => Promise<void>; onClose: () => void }) {
  const [text, setText] = useState('');
  const [skip, setSkip] = useState<Record<number, boolean>>({});
  const roleMap = useMemo(() => new Map(d.roles.map((r) => [r.toLowerCase(), r])), [d.roles]);

  const rows: Parsed[] = useMemo(() => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
    const cells = (line.includes('\t') ? line.split('\t') : line.split(',')).map((x) => x.trim()).filter(Boolean);
    let email = '', linkedin = '';
    const rest: string[] = [];
    cells.forEach((cell) => {
      if (!email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cell)) email = cell.toLowerCase();
      else if (!linkedin && /linkedin\.com/i.test(cell)) linkedin = cell;
      else rest.push(cell);
    });
    const name = rest[0] || '';
    const rawRole = rest[1] || '';
    const role = rawRole ? roleMap.get(rawRole.toLowerCase()) || rawRole : '';
    const dupC = email ? d.contacts.find((c) => c.email.toLowerCase() === email) : undefined;
    return { name, role, email: email || suggestEmail(company.email_pattern, name, company.domain), linkedin_url: linkedin, dup: dupC ? `Already in ${d.companies.find((x) => x.id === dupC.company_id)?.name || 'the database'}` : '', newRole: !!rawRole && !roleMap.has(rawRole.toLowerCase()) };
  }).filter((r) => r.name), [text, roleMap, d.contacts, d.companies, company]);

  const include = (i: number) => (skip[i] !== undefined ? !skip[i] : !rows[i].dup);
  const chosen = rows.filter((_, i) => include(i));

  const add = async () => {
    const newRoles = [...new Set(chosen.filter((r) => r.newRole).map((r) => r.role))];
    for (const r of newRoles) await addRole(r);
    const made = chosen.map((r) => blankContact(company.id, { name: r.name, first_name: r.name.split(/\s+/)[0], role: r.role, email: r.email, linkedin_url: r.linkedin_url }));
    onClose();
    await act.save(made, made);
  };

  return (
    <Modal title="Paste a list" onClose={onClose} wide>
      <div className="col">
        <textarea className="textarea" style={{ minHeight: 120 }} autoFocus value={text} onChange={(e) => { setText(e.target.value); setSkip({}); }}
          placeholder={'Priya Sharma, Head of Product, priya@northwind.com\nAmit Rao, CTO, amit@northwind.com'} aria-label="Pasted list" />
        {rows.length > 0 && (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th /><th>Name</th><th>Role</th><th>Email</th><th /></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td><input type="checkbox" className="checkbox" aria-label={`Include ${r.name}`} checked={include(i)} onChange={(e) => setSkip({ ...skip, [i]: !e.target.checked })} /></td>
                    <td>{r.name}</td>
                    <td className={r.newRole ? '' : 'muted'}>{r.role || '—'}{r.newRole && <span className="pill tone-yellow" style={{ marginLeft: 8 }}>New role</span>}</td>
                    <td className={r.email && company.email_pattern && !text.includes(r.email) ? 'faint' : 'muted'}>{r.email || '—'}</td>
                    <td>{r.dup && <span className="warn"><AlertTriangle {...iconProps} />{r.dup}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="modal-foot">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!chosen.length} onClick={add}>Add {chosen.length || ''} {chosen.length === 1 ? 'person' : 'people'}</button>
      </div>
    </Modal>
  );
}

