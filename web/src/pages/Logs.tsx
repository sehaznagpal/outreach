import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, X } from 'lucide-react';
import { call } from '../api';
import { useData, useStore } from '../store';
import { addDays, dateOf, fmtDay, nowIso, startOfWeek, timeOf, todayStr, toLocalInput } from '../lib/dates';
import { csv, type Batch, type Data } from '../types';
import { BatchStatusPill, Empty, iconProps, Modal, Switch } from '../components/ui';

type Group = 'Today' | 'Tomorrow' | 'This week' | 'Later' | 'Sent';
const ORDER: Group[] = ['Today', 'Tomorrow', 'This week', 'Later', 'Sent'];

function groupOf(b: Batch, today: string): Group {
  if (b.status !== 'planned') return 'Sent';
  const day = dateOf(b.scheduled_at);
  if (day <= today) return 'Today';
  if (day === addDays(today, 1)) return 'Tomorrow';
  if (day <= addDays(startOfWeek(today), 6)) return 'This week';
  return 'Later';
}

export function Logs() {
  const d = useData();
  const { mutate } = useStore();
  const today = todayStr();
  const [planning, setPlanning] = useState(false);

  const load = useMemo(() => {
    const m: Record<string, number> = {};
    d.batches.filter((b) => b.status !== 'cancelled').forEach((b) => { const k = dateOf(b.scheduled_at); m[k] = (m[k] || 0) + csv(b.contact_ids).length; });
    return m;
  }, [d.batches]);

  const groups = useMemo(() => {
    const g: Record<Group, Batch[]> = { Today: [], Tomorrow: [], 'This week': [], Later: [], Sent: [] };
    d.batches.forEach((b) => g[groupOf(b, today)].push(b));
    (Object.keys(g) as Group[]).forEach((k) => g[k].sort((a, b) => (k === 'Sent' ? (a.scheduled_at < b.scheduled_at ? 1 : -1) : (a.scheduled_at < b.scheduled_at ? -1 : 1))));
    g.Sent = g.Sent.slice(0, 40);
    return g;
  }, [d.batches, today]);

  const readyUnscheduled = d.contacts.filter((c) => c.status === 'ready' && !c.batch_id).length;
  const empty = !d.batches.length;

  return (
    <>
      <div className="page-head">
        <div><h1 className="page-title">Logs</h1><p className="page-sub">Every batch, by day. Sends go out around the scheduled time.</p></div>
        <div className="row">
          <label className="row small muted"><Switch label="Pause all sending" checked={d.settings.paused}
            onChange={(v) => mutate('saveSettings', { settings: { paused: v } }, (x) => ({ ...x, settings: { ...x.settings, paused: v } }))} />
            Pause all sending</label>
          <button className="btn primary" onClick={() => setPlanning(true)}>Plan batches{readyUnscheduled ? ` (${readyUnscheduled} ready)` : ''}</button>
        </div>
      </div>

      {d.settings.paused && <div className="banner attn">Sending is paused. Planned batches wait until you switch it back on.</div>}
      {d.settings.test_mode && <div className="banner">Test mode is on. Batches send to {d.settings.test_email || 'your test address'} only.</div>}

      {empty && <Empty text="No batches yet. Mark people as ready on a company page and they are queued here." action="Plan batches" onAction={() => setPlanning(true)} />}

      {ORDER.map((g) => groups[g].length > 0 && (
        <section key={g} className="group">
          <div className="group-head"><h2>{g}</h2><span className="faint small">{groups[g].length} {groups[g].length === 1 ? 'batch' : 'batches'}</span></div>
          {groups[g].map((b) => <BatchCard key={b.id} batch={b} d={d} total={load[dateOf(b.scheduled_at)] || 0} />)}
        </section>
      ))}

      {planning && <PlanModal onClose={() => setPlanning(false)} />}
    </>
  );
}

function BatchCard({ batch: b, d, total }: { batch: Batch; d: Data; total: number }) {
  const { mutate } = useStore();
  const co = d.companies.find((c) => c.id === b.company_id);
  const planned = b.status === 'planned';
  const over = planned && total > d.settings.daily_cap;
  const people = csv(b.contact_ids).map((id) => d.contacts.find((c) => c.id === id)).filter(Boolean);

  const resched = (v: string) => {
    if (!v || v.length < 16) return;
    mutate('rescheduleBatch', { id: b.id, scheduled_at: v }, (x) => ({ ...x, batches: x.batches.map((y) => (y.id === b.id ? { ...y, scheduled_at: `${v}:00+05:30` } : y)) }));
  };
  const cancel = () => {
    if (!window.confirm('Cancel this batch? Its people go back to Ready.')) return;
    mutate('cancelBatch', { id: b.id }, (x) => ({
      ...x,
      batches: x.batches.map((y) => (y.id === b.id ? { ...y, status: 'cancelled' } : y)),
      contacts: x.contacts.map((c) => (c.batch_id === b.id ? { ...c, batch_id: '', status: b.type === 'first' ? 'ready' : c.status } : c)),
    }));
  };
  const removePerson = (id: string) => {
    mutate('removeFromBatch', { batch_id: b.id, contact_id: id }, (x) => {
      const ids = csv(b.contact_ids).filter((i) => i !== id);
      return {
        ...x,
        batches: ids.length ? x.batches.map((y) => (y.id === b.id ? { ...y, contact_ids: ids.join(',') } : y)) : x.batches.filter((y) => y.id !== b.id),
        contacts: x.contacts.map((c) => (c.id === id ? { ...c, batch_id: '', status: b.type === 'first' ? 'ready' : c.status } : c)),
      };
    });
  };

  return (
    <article className="batch" aria-label={`Batch for ${co?.name}`}>
      <div className="col" style={{ gap: 8 }}>
        <Link to={`/companies/${b.company_id}`} className="co">{co?.name || 'Removed company'}</Link>
        <div className="row wrap" style={{ gap: 6 }}>
          <span className="pill">{b.type === 'first' ? 'First email' : 'Follow-up'}</span>
          <BatchStatusPill status={b.status} />
        </div>
        {!planned && <div className="small muted">{fmtDay(dateOf(b.scheduled_at))} · {timeOf(b.scheduled_at)}</div>}
        {!planned && b.reason && (b.status === 'cancelled' || b.status === 'partial') && <div className="small muted">{b.reason}</div>}
        {over && <div className="capwarn"><AlertTriangle {...iconProps} />{total} that day, cap {d.settings.daily_cap}</div>}
        {planned && b.scheduled_at < nowIso() && <div className="xs faint">Due. Goes out on the next run.</div>}
      </div>

      <div className="batch-people">
        {people.map((c) => c && (
          <div key={c.id} className="batch-person">
            <span className="grow trunc"><b style={{ fontWeight: 500 }}>{c.name}</b> <span className="muted">· {c.role || 'No role'} · {d.copies.find((x) => x.id === c.assigned_copy_id)?.name || 'Copy not set'}</span></span>
            {planned && <button className="icon-btn" aria-label={`Remove ${c.name} from batch`} onClick={() => removePerson(c.id)}><X {...iconProps} /></button>}
          </div>
        ))}
        {!people.length && <span className="muted small">No people left in this batch.</span>}
      </div>

      <div className="batch-actions">
        {planned && (
          <>
            <input className="input dt" type="datetime-local" aria-label="Date and time" defaultValue={toLocalInput(b.scheduled_at)} key={b.scheduled_at}
              onBlur={(e) => { if (e.target.value !== toLocalInput(b.scheduled_at)) resched(e.target.value); }} />
            <button className="btn sm danger" onClick={cancel}>Cancel batch</button>
          </>
        )}
      </div>
    </article>
  );
}

interface PlanRes { plan: Array<{ company_id: string; company_name: string; date: string; scheduled_at: string; names: string[] }>; days: Array<{ date: string; total: number; cap: number; over_cap: boolean }> }

function PlanModal({ onClose }: { onClose: () => void }) {
  const d = useData();
  const { mutate, toast } = useStore();
  const ready = useMemo(() => d.companies.map((c) => ({ c, n: d.contacts.filter((x) => x.company_id === c.id && x.status === 'ready' && !x.batch_id).length })).filter((x) => x.n > 0), [d]);
  const [picked, setPicked] = useState<string[]>(ready.map((r) => r.c.id));
  const [start, setStart] = useState(todayStr());
  const [time, setTime] = useState(d.settings.default_send_time);
  const [spacing, setSpacing] = useState<'daily' | 'every2'>('daily');
  const [preview, setPreview] = useState<PlanRes | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!picked.length) { setPreview(null); return; }
    let live = true;
    const t = setTimeout(() => {
      call<PlanRes>('planBatches', { company_ids: picked, start, time, spacing, dry_run: true })
        .then((r) => { if (live) setPreview(r); }).catch((e) => toast('error', e.message));
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [picked, start, time, spacing]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirm = async () => {
    setBusy(true);
    const res = await mutate('planBatches', { company_ids: picked, start, time, spacing, dry_run: false });
    setBusy(false);
    if (res) onClose();
  };
  const anyOver = preview?.days.some((x) => x.over_cap);

  return (
    <Modal title="Plan batches" onClose={onClose} wide>
      {!ready.length ? (
        <div className="empty"><p>Nobody is waiting. Mark people as ready on a company page first. People removed from a batch also show up here.</p></div>
      ) : (
        <div className="field-row" style={{ alignItems: 'start' }}>
          <div className="col">
            <div className="label">Companies with ready people</div>
            <div className="plan-grid">
              {ready.map(({ c, n }) => (
                <label key={c.id} className="plan-company">
                  <input type="checkbox" className="checkbox" checked={picked.includes(c.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, c.id] : picked.filter((x) => x !== c.id))} />
                  <span className="grow">{c.name}</span><span className="muted small">{n} ready</span>
                </label>
              ))}
            </div>
            <div className="field-row">
              <div className="field"><label htmlFor="pl-start">Start date</label><input id="pl-start" className="input" type="date" style={{ colorScheme: 'dark' }} value={start} onChange={(e) => setStart(e.target.value)} /></div>
              <div className="field"><label htmlFor="pl-time">Time</label><input id="pl-time" className="input" type="time" style={{ colorScheme: 'dark' }} value={time} onChange={(e) => setTime(e.target.value)} /></div>
            </div>
            <div className="field"><label htmlFor="pl-sp">Spacing</label>
              <select id="pl-sp" className="select" value={spacing} onChange={(e) => setSpacing(e.target.value as 'daily' | 'every2')}>
                <option value="daily">Every send day</option><option value="every2">Every 2nd send day</option>
              </select></div>
          </div>
          <div>
            <div className="label" style={{ marginBottom: 8 }}>Preview</div>
            {!preview ? <p className="muted small">Pick at least one company.</p> : (
              <>
                {preview.plan.map((p, i) => (
                  <div key={i} className="plan-line">
                    <span className="muted">{fmtDay(p.date)}</span>
                    <span><b style={{ fontWeight: 500 }}>{p.company_name}</b> <span className="muted">· {p.names.join(', ')}</span></span>
                    <span className="muted nowrap">{timeOf(p.scheduled_at)}</span>
                  </div>
                ))}
                {preview.days.filter((x) => x.over_cap).map((x) => (
                  <div key={x.date} className="warn" style={{ marginTop: 10 }}><AlertTriangle {...iconProps} />{fmtDay(x.date)} would have {x.total} emails, over the cap of {x.cap}. Nothing is moved for you.</div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
      <div className="modal-foot">
        <button className="btn ghost" onClick={onClose}>Close</button>
        {ready.length > 0 && <button className="btn primary" disabled={busy || !picked.length || !preview?.plan.length} onClick={confirm}>{anyOver ? 'Create anyway' : 'Create batches'}</button>}
      </div>
    </Modal>
  );
}
