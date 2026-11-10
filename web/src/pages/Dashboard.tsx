import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { useData } from '../store';
import { computeStats } from '../lib/stats';
import { addDays, countdown, fmtDay, fmtShort, greeting, isWeekday, timeOf, weekdayIdx } from '../lib/dates';
import { csv } from '../types';
import { CountUp, Empty, iconProps, Ring } from '../components/ui';

export function Dashboard() {
  const d = useData();
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(t); }, []);
  const s = useMemo(() => computeStats(d), [d]);
  const name = (d.settings.sender_name || 'Sehaz').split(' ')[0];
  const co = (id: string) => d.companies.find((c) => c.id === id);
  const contactName = (id: string) => d.contacts.find((c) => c.id === id)?.first_name || d.contacts.find((c) => c.id === id)?.name || '';

  const heroLine = s.todayBatches.length
    ? <>{s.todayBatches.length} {s.todayBatches.length === 1 ? 'batch goes' : 'batches go'} out <em>today</em> · {s.todayEmails} {s.todayEmails === 1 ? 'email' : 'emails'} · next at {timeOf(s.todayBatches[0].scheduled_at)}</>
    : <>Nothing scheduled. Pick a company and queue a batch.</>;

  // heatmap: 12 weeks, Monday-first columns
  const start = addDays(s.weekStart, -11 * 7);
  const cells: string[] = [];
  for (let i = 0; i < 12 * 7; i++) cells.push(addDays(start, i));

  const nb = s.nextBatch;
  const nbCompany = nb ? co(nb.company_id) : null;

  return (
    <>
      <div className="bento">
        <section className="card grad hero span-8" aria-label="Today">
          <div className="orb" aria-hidden />
          <h1>{greeting()}, {name}</h1>
          <p>{heroLine}</p>
        </section>

        <Link to="/logs" className="card grad warm next-batch span-4" style={{ display: 'flex', flexDirection: 'column' }} aria-label="Next batch">
          <h2>Next batch</h2>
          {nb && nbCompany ? (
            <>
              <div className="when">{fmtDay(nb.scheduled_at.slice(0, 10), { weekday: 'short', day: 'numeric', month: 'short' })}, {timeOf(nb.scheduled_at)}</div>
              <p style={{ fontFamily: 'var(--font-serif)', fontSize: 22, marginTop: 10 }}>{nbCompany.name}</p>
              <p className="muted small" style={{ marginTop: 4 }}>{countdown(nb.scheduled_at)}</p>
              <p className="small" style={{ marginTop: 'auto', paddingTop: 16 }}>{csv(nb.contact_ids).map(contactName).filter(Boolean).join(', ')}</p>
            </>
          ) : <p style={{ fontFamily: 'var(--font-serif)', fontSize: 22 }}>No batch queued.</p>}
        </Link>

        {[
          { label: 'Sent this week', n: s.sentThisWeek, sub: 'emails and follow-ups' },
          { label: 'Replies this week', n: s.repliesThisWeek, sub: `${s.replyRate}% reply rate overall` },
          { label: 'Active companies', n: s.activeCompanies, sub: `${d.companies.length} in total` },
          { label: 'Queued, next 7 days', n: s.queued7, sub: 'emails planned' },
        ].map((k) => (
          <section key={k.label} className="card kpi span-3">
            <h2>{k.label}</h2>
            <div className="num"><CountUp to={k.n} /></div>
            <div className="sub">{k.sub}</div>
          </section>
        ))}

        <section className="card span-4" aria-label="Weekly goal">
          <h2>Weekly goal</h2>
          <div className="ring-wrap">
            <Ring value={s.companiesThisWeek} max={d.settings.weekly_goal_companies} />
            <div>
              <div className="ring-num">{s.companiesThisWeek} <span className="faint">of {d.settings.weekly_goal_companies}</span></div>
              <div className="small muted">companies added this week</div>
            </div>
          </div>
          <div className="small" style={{ marginTop: 22, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
            <span className="serif" style={{ fontSize: 22 }}>{s.streak}</span> <span className="muted">{s.streak === 1 ? 'weekday' : 'weekdays'} in a row with an email sent</span>
          </div>
        </section>

        <section className="card span-8" aria-label="Activity">
          <h2>Activity, last 12 weeks</h2>
          <div className="hm" role="img" aria-label="Heatmap of emails sent per day">
            {cells.map((day) => {
              const h = s.heat[day];
              const n = h ? h.first + h.fu : 0;
              const future = day > s.today;
              const lvl = n === 0 ? 0 : n <= 1 ? 1 : n <= 3 ? 2 : n <= 6 ? 3 : 4;
              let cls = 'hm-cell';
              if (future) cls += ' future';
              else if (!isWeekday(day) && n === 0) cls += ' wkend';
              else if (n === 0) cls += ' blank';
              else cls += ` ${h.fu > h.first ? 'fu' : 'first'} l${lvl}`;
              return <div key={day} className={cls} title={`${fmtDay(day)}: ${n} sent`} data-dow={weekdayIdx(day)} />;
            })}
          </div>
          <div className="legend">
            <span><span className="dot yellow" /> First emails</span>
            <span><span className="dot sky" /> Follow-ups lead</span>
            <span><span className="dot" style={{ background: 'transparent', border: '1px solid var(--line-strong)' }} /> Weekday with nothing sent</span>
          </div>
        </section>

        <section className="card span-7" aria-label="Recent replies" style={{ minHeight: 340 }}>
          <h2>Recent replies</h2>
          {s.recentReplies.length ? s.recentReplies.map(({ contact, company, days }) => (
            <Link key={contact.id} to={`/companies/${contact.company_id}`} className="reply-item">
              <div>
                <div className="reply-name">{contact.name}</div>
                <div className="small muted">{company?.name}{contact.role ? ` · ${contact.role}` : ''}</div>
              </div>
              <div className="small muted right nowrap">
                {days === null ? 'replied' : days === 0 ? 'same day' : `${days} ${days === 1 ? 'day' : 'days'} after sending`}
                <div className="xs faint">{fmtShort(contact.replied_at.slice(0, 10))}</div>
              </div>
            </Link>
          )) : <Empty text="No replies yet. They will show up here as soon as someone writes back." />}
        </section>

        <section className="card span-5" aria-label="Needs attention">
          <h2>Needs attention</h2>
          {s.attention.length ? s.attention.map((a) => (
            <div key={a.id} className="attn-item">
              <AlertCircle {...iconProps} color="var(--ember)" style={{ flex: 'none', marginTop: 3 }} />
              <Link to={a.to}>{a.text}</Link>
            </div>
          )) : <p className="muted">Nothing needs you right now.</p>}
        </section>
      </div>
    </>
  );
}
