import type { Data, SendLogRow } from '../types';

export interface SendTrack {
  /** non-automatic open events (approximate) */
  opens: number;
  /** every open event, including likely automatic ones */
  allOpens: number;
  clicks: number;
  clickKeys: string[];
  lastAt: string;
}

export const MIN_SENDS = 20;

/** Events grouped by send. "Opened" means at least one non-auto open; automatic opens stay in allOpens. */
export function trackBySend(d: Data): Record<string, SendTrack> {
  const m: Record<string, SendTrack> = {};
  (d.events || []).forEach((e) => {
    const t = m[e.send_id] || (m[e.send_id] = { opens: 0, allOpens: 0, clicks: 0, clickKeys: [], lastAt: '' });
    if (e.type === 'open') { t.allOpens++; if (!e.likely_auto) { t.opens++; if (e.at > t.lastAt) t.lastAt = e.at; } }
    else { t.clicks++; if (e.link_key && !t.clickKeys.includes(e.link_key)) t.clickKeys.push(e.link_key); if (e.at > t.lastAt) t.lastAt = e.at; }
  });
  return m;
}

const repliedContact = (d: Data, id: string) => !!d.contacts.find((c) => c.id === id)?.replied_at;

export interface Rates { sent: number; opened: number; clicked: number; replied: number }

/** Unique-per-send counts for a set of sends. */
export function ratesFor(d: Data, sends: SendLogRow[], tr: Record<string, SendTrack>): Rates {
  let opened = 0, clicked = 0, replied = 0;
  sends.forEach((s) => {
    const t = tr[s.id];
    if (t && t.opens > 0) opened++;
    if (t && t.clicks > 0) clicked++;
    if (repliedContact(d, s.contact_id)) replied++;
  });
  return { sent: sends.length, opened, clicked, replied };
}

export const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '0%');
