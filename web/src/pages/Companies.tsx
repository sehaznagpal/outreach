import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { LayoutGrid, Rows3 } from 'lucide-react';
import { useData } from '../store';
import { CompanyStatusPill, Empty, iconProps } from '../components/ui';
import { fmtDay, dateOf, nowIso } from '../lib/dates';
import type { Company, CompanyStatus } from '../types';

export function Companies({ onNew }: { onNew: () => void }) {
  const d = useData();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | CompanyStatus>('all');
  const [industry, setIndustry] = useState('all');
  const [view, setView] = useState<'grid' | 'table'>(() => (localStorage.getItem('outreach.view') as 'grid' | 'table') || 'grid');
  const setV = (v: 'grid' | 'table') => { setView(v); try { localStorage.setItem('outreach.view', v); } catch { /* ignore */ } };

  const industries = useMemo(() => [...new Set(d.companies.map((c) => c.industry).filter(Boolean))].sort(), [d.companies]);
  const info = (c: Company) => {
    const people = d.contacts.filter((x) => x.company_id === c.id);
    const next = d.batches.filter((b) => b.company_id === c.id && b.status === 'planned' && b.scheduled_at > nowIso()).sort((a, b) => (a.scheduled_at < b.scheduled_at ? -1 : 1))[0];
    return {
      contacts: people.length,
      ready: people.filter((p) => p.status === 'ready' || p.status === 'scheduled').length,
      sent: people.filter((p) => ['sent', 'followed_up', 'replied', 'bounced'].includes(p.status)).length,
      replied: people.filter((p) => p.status === 'replied').length,
      next: next ? fmtDay(dateOf(next.scheduled_at)) : '',
    };
  };
  const list = d.companies
    .filter((c) => (status === 'all' || c.status === status) && (industry === 'all' || c.industry === industry) &&
      (`${c.name} ${c.industry} ${c.domain}`).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <div className="page-head">
        <div><h1 className="page-title">Companies</h1><p className="page-sub">{d.companies.length} {d.companies.length === 1 ? 'company' : 'companies'}</p></div>
        <button className="btn primary" onClick={onNew}>New company</button>
      </div>

      <div className="toolbar">
        <input id="company-search" className="input" placeholder="Search companies  ( / )" aria-label="Search companies" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as 'all' | CompanyStatus)}>
          <option value="all">All statuses</option><option value="active">Active</option><option value="paused">Paused</option><option value="done">Done</option><option value="replied">Replied</option>
        </select>
        <select className="select" aria-label="Industry" value={industry} onChange={(e) => setIndustry(e.target.value)}>
          <option value="all">All industries</option>{industries.map((i) => <option key={i} value={i}>{i}</option>)}
        </select>
        <div className="spacer" />
        <div className="seg" role="group" aria-label="View">
          <button aria-pressed={view === 'grid'} onClick={() => setV('grid')} aria-label="Grid"><LayoutGrid {...iconProps} /></button>
          <button aria-pressed={view === 'table'} onClick={() => setV('table')} aria-label="Table"><Rows3 {...iconProps} /></button>
        </div>
      </div>

      {!d.companies.length ? <Empty text="No companies yet. Add the first one to start building a list." action="New company" onAction={onNew} />
        : !list.length ? <Empty text="No company matches these filters." /> : view === 'grid' ? (
          <div className="c-grid">
            {list.map((c) => {
              const i = info(c);
              return (
                <Link key={c.id} to={`/companies/${c.id}`} className="card c-card">
                  <div className="row"><CompanyStatusPill status={c.status} /><span className="spacer" />{c.industry && <span className="pill">{c.industry}</span>}</div>
                  <div className="name">{c.name}</div>
                  <div className="counts">
                    <div><b>{i.contacts}</b><span>people</span></div><div><b>{i.ready}</b><span>ready</span></div>
                    <div><b>{i.sent}</b><span>sent</span></div><div><b>{i.replied}</b><span>replied</span></div>
                  </div>
                  <div className="small faint">{i.next ? `Next batch ${i.next}` : 'No batch planned'}</div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="card flat tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Company</th><th>Industry</th><th>People</th><th>Ready</th><th>Sent</th><th>Replied</th><th>Next batch</th><th>Status</th></tr></thead>
              <tbody>
                {list.map((c) => {
                  const i = info(c);
                  return (
                    <tr key={c.id}>
                      <td><Link to={`/companies/${c.id}`} className="serif" style={{ fontSize: 18 }}>{c.name}</Link></td>
                      <td className="muted">{c.industry}</td>
                      <td className="tnum">{i.contacts}</td><td className="tnum">{i.ready}</td><td className="tnum">{i.sent}</td><td className="tnum">{i.replied}</td>
                      <td className="muted">{i.next || '—'}</td><td><CompanyStatusPill status={c.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
    </>
  );
}
