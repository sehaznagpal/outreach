import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { call } from '../api';
import { useData } from '../store';
import { addDays, addMonths, daysInMonth, DOW, dateOf, fmtDay, fmtMonth, isWeekday, monthOf, timeOf, todayStr, weekdayIdx } from '../lib/dates';
import { csv, type Batch, type SendLogRow } from '../types';
import { BatchStatusPill, iconProps } from '../components/ui';

export function Calendar() {
  const d = useData();
  const today = todayStr();
  const [month, setMonth] = useState(monthOf(today));
  const [sel, setSel] = useState<string | null>(today);
  const [remote, setRemote] = useState<{ sendlog: SendLogRow[]; batches: Batch[] }>({ sendlog: [], batches: [] });

  useEffect(() => {
    let live = true;
    call<{ sendlog: SendLogRow[]; batches: Batch[] }>('getCalendar', { month }).then((r) => { if (live) setRemote(r); }).catch(() => undefined);
    return () => { live = false; };
  }, [month]);

  const { logs, batches } = useMemo(() => {
    const logs = new Map<string, SendLogRow>();
    [...remote.sendlog, ...d.sendlog].forEach((r) => { if (r.result === 'ok') logs.set(r.id, r); });
    const batches = new Map<string, Batch>();
    [...remote.batches, ...d.batches].forEach((b) => batches.set(b.id, b));
    return { logs: [...logs.values()], batches: [...batches.values()] };
  }, [remote, d.sendlog, d.batches]);

  const byDay = useMemo(() => {
    const m: Record<string, { first: number; fu: number; planned: number }> = {};
    const get = (k: string) => m[k] || (m[k] = { first: 0, fu: 0, planned: 0 });
    logs.forEach((r) => { const x = get(dateOf(r.sent_at)); if (r.type === 'first') x.first++; else x.fu++; });
    batches.filter((b) => b.status === 'planned').forEach((b) => { get(dateOf(b.scheduled_at)).planned += csv(b.contact_ids).length; });
    return m;
  }, [logs, batches]);

  const first = `${month}-01`;
  const lead = weekdayIdx(first);
  const total = daysInMonth(month);
  const cells: Array<string | null> = [];
  for (let i = 0; i < lead; i++) cells.push(addDays(first, i - lead));
  for (let i = 0; i < total; i++) cells.push(addDays(first, i));
  while (cells.length % 7) cells.push(addDays(first, cells.length - lead));

  const co = (id: string) => d.companies.find((c) => c.id === id);
  const ct = (id: string) => d.contacts.find((c) => c.id === id);
  const dayLogs = sel ? logs.filter((r) => dateOf(r.sent_at) === sel).sort((a, b) => (a.sent_at < b.sent_at ? -1 : 1)) : [];
  const dayBatches = sel ? batches.filter((b) => dateOf(b.scheduled_at) === sel && b.status === 'planned') : [];

  return (
    <>
      <div className="page-head">
        <div><h1 className="page-title">Calendar</h1><p className="page-sub">What went out, and what is queued.</p></div>
        <div className="row">
          <button className="icon-btn" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}><ChevronLeft {...iconProps} /></button>
          <span className="serif" style={{ fontSize: 22, minWidth: 170, textAlign: 'center' }}>{fmtMonth(month)}</span>
          <button className="icon-btn" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}><ChevronRight {...iconProps} /></button>
          <button className="btn sm" onClick={() => { setMonth(monthOf(today)); setSel(today); }}>Today</button>
        </div>
      </div>

      <div className="cal-layout">
        <div>
          <div className="cal">
            {DOW.map((x) => <div key={x} className="cal-dow">{x}</div>)}
            {cells.map((day, i) => {
              const out = !day || monthOf(day) !== month;
              const n = day ? byDay[day] : undefined;
              const missed = day && !out && day < today && isWeekday(day) && !(n && (n.first || n.fu));
              return (
                <button key={i} className={`cal-day ${out ? 'out' : ''} ${day === today ? 'today' : ''} ${day === sel ? 'sel' : ''} ${missed ? 'missed' : ''}`}
                  onClick={() => day && setSel(day)} aria-label={day ? fmtDay(day) : ''}>
                  <span className="dnum">{day ? Number(day.slice(8)) : ''}</span>
                  {n && !out && (
                    <span className="dots">
                      {n.first > 0 && <span><span className="dot yellow" />{n.first}</span>}
                      {n.fu > 0 && <span><span className="dot sky" />{n.fu}</span>}
                      {n.planned > 0 && <span><span className="dot outline" />{n.planned}</span>}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="legend">
            <span><span className="dot yellow" /> First emails</span>
            <span><span className="dot sky" /> Follow-ups</span>
            <span><span className="dot outline" /> Planned</span>
          </div>
        </div>

        <aside className="card" aria-label="Selected day">
          <h2>{sel ? fmtDay(sel, { weekday: 'long', day: 'numeric', month: 'long' }) : 'Pick a day'}</h2>
          {sel && !dayLogs.length && !dayBatches.length && (
            <div className="empty"><p>{sel < today ? 'Nothing was sent on this day.' : 'Nothing scheduled for this day.'}</p><Link className="btn" to="/logs">Open logs</Link></div>
          )}
          {dayBatches.length > 0 && <p className="label" style={{ marginBottom: 8 }}>Planned</p>}
          {dayBatches.map((b) => (
            <div key={b.id} className="attn-item">
              <div className="grow">
                <Link to="/logs" className="serif" style={{ fontSize: 20 }}>{co(b.company_id)?.name}</Link>
                <div className="small muted">{timeOf(b.scheduled_at)} · {b.type === 'first' ? 'First emails' : 'Follow-ups'} · {csv(b.contact_ids).map((id) => ct(id)?.first_name).filter(Boolean).join(', ')}</div>
              </div>
              <BatchStatusPill status={b.status} />
            </div>
          ))}
          {dayLogs.length > 0 && <p className="label" style={{ margin: '14px 0 8px' }}>Sent</p>}
          {dayLogs.map((r) => (
            <div key={r.id} className="attn-item">
              <span className={`dot ${r.type === 'first' ? 'yellow' : 'sky'}`} style={{ marginTop: 9 }} />
              <div className="grow">
                <Link to={`/companies/${r.company_id}`}>{ct(r.contact_id)?.name || 'Removed contact'}</Link>
                <div className="small muted">{co(r.company_id)?.name} · {timeOf(r.sent_at)} · {r.type === 'first' ? 'First email' : 'Follow-up'}</div>
              </div>
            </div>
          ))}
        </aside>
      </div>
    </>
  );
}
