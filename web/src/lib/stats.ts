import { csv, type Batch, type Contact, type Data } from '../types';
import { addDays, dateOf, diffDays, fmtDay, isWeekday, nowIso, startOfWeek, todayStr } from './dates';
import { missingForCompany } from './render';

export interface AttentionItem { id: string; text: string; to: string }
export interface HeatDay { first: number; fu: number }

export const batchSize = (b: Batch) => csv(b.contact_ids).length;

export function computeStats(d: Data) {
  const today = todayStr();
  const now = nowIso();
  const weekStart = startOfWeek(today);
  const ok = d.sendlog.filter((r) => r.result === 'ok');
  const co = (id: string) => d.companies.find((c) => c.id === id);

  const sentThisWeek = ok.filter((r) => dateOf(r.sent_at) >= weekStart).length;
  const repliesThisWeek = d.contacts.filter((c) => c.replied_at && dateOf(c.replied_at) >= weekStart).length;
  const everSent = d.contacts.filter((c) => c.first_sent_at).length;
  const everReplied = d.contacts.filter((c) => c.replied_at).length;
  const replyRate = everSent ? Math.round((everReplied / everSent) * 100) : 0;
  const activeCompanies = d.companies.filter((c) => c.status === 'active').length;

  const planned = d.batches.filter((b) => b.status === 'planned').sort((a, b) => (a.scheduled_at < b.scheduled_at ? -1 : 1));
  const horizon = addDays(today, 7);
  const queued7 = planned.filter((b) => dateOf(b.scheduled_at) <= horizon).reduce((n, b) => n + batchSize(b), 0);
  const upcoming = planned.filter((b) => b.scheduled_at > now);
  const nextBatch = upcoming[0] || null;
  const todayBatches = planned.filter((b) => dateOf(b.scheduled_at) === today && b.scheduled_at > now);
  const todayEmails = todayBatches.reduce((n, b) => n + batchSize(b), 0);

  // heatmap + streak
  const heat: Record<string, HeatDay> = {};
  ok.forEach((r) => {
    const k = dateOf(r.sent_at);
    const h = heat[k] || (heat[k] = { first: 0, fu: 0 });
    if (r.type === 'first') h.first++; else h.fu++;
  });
  let streak = 0;
  for (let day = today, i = 0; i < 400; day = addDays(day, -1), i++) {
    if (!isWeekday(day)) continue;
    const n = heat[day] ? heat[day].first + heat[day].fu : 0;
    if (n > 0) streak++;
    else if (day === today) continue;
    else break;
  }

  const companiesThisWeek = d.companies.filter((c) => dateOf(c.created_at) >= weekStart).length;

  const recentReplies = d.contacts
    .filter((c) => c.replied_at)
    .sort((a, b) => (a.replied_at < b.replied_at ? 1 : -1))
    .slice(0, 5)
    .map((c: Contact) => ({
      contact: c,
      company: co(c.company_id),
      days: c.first_sent_at ? Math.max(0, diffDays(dateOf(c.first_sent_at), dateOf(c.replied_at))) : null,
    }));

  // needs attention
  const attention: AttentionItem[] = [];
  if (d.settings.paused) attention.push({ id: 'paused', text: 'Sending is paused. Nothing will go out until you switch it back on.', to: '/logs' });
  if (d.meta.cap_hit_date === today) attention.push({ id: 'cap', text: 'Daily cap reached today. Remaining batches wait for tomorrow.', to: '/logs' });
  d.contacts.filter((c) => c.status === 'bounced').forEach((c) =>
    attention.push({ id: 'b' + c.id, text: `${c.name} at ${co(c.company_id)?.name || 'a company'} bounced (${c.email}).`, to: `/companies/${c.company_id}` }));
  d.companies.forEach((c) => {
    const n = d.contacts.filter((x) => x.company_id === c.id && x.status === 'ready' && !x.batch_id).length;
    if (n) attention.push({ id: 'r' + c.id, text: `${c.name} has ${n} ready ${n === 1 ? 'contact' : 'contacts'} with no batch.`, to: '/logs' });
  });
  const perDay: Record<string, number> = {};
  d.batches.filter((b) => b.status === 'planned').forEach((b) => { const k = dateOf(b.scheduled_at); perDay[k] = (perDay[k] || 0) + batchSize(b); });
  Object.keys(perDay).sort().forEach((k) => {
    if (perDay[k] > d.settings.daily_cap) attention.push({ id: 'cap' + k, text: `${fmtDay(k)} has ${perDay[k]} emails planned, over the cap of ${d.settings.daily_cap}.`, to: '/logs' });
  });
  d.batches.filter((b) => b.status === 'partial').slice(-5).forEach((b) =>
    attention.push({ id: 'p' + b.id, text: `A batch for ${co(b.company_id)?.name || 'a company'} on ${fmtDay(dateOf(b.scheduled_at))} was only partly sent.`, to: '/logs' }));
  d.companies.filter((c) => c.status === 'active').forEach((c) => {
    const hasLines = d.lines.some((l) => l.company_id === c.id);
    const bad: string[] = [];
    [...csv(c.copy_ids), ...csv(c.followup_copy_ids)].forEach((id) => {
      const cp = d.copies.find((x) => x.id === id);
      if (!cp) return;
      missingForCompany(cp, c, d.settings, hasLines).forEach((v) => { if (!bad.includes(v)) bad.push(v); });
    });
    if (bad.length) attention.push({ id: 'v' + c.id, text: `${c.name}: a chosen copy uses ${bad.map((v) => `{{${v}}}`).join(', ')}, which is not filled in.`, to: `/companies/${c.id}` });
  });

  return {
    today, weekStart, sentThisWeek, repliesThisWeek, replyRate, activeCompanies, queued7, nextBatch,
    todayBatches, todayEmails, heat, streak, companiesThisWeek, recentReplies, attention,
  };
}
