// Client-side mirror of apps-script/Render.gs, used for the live Content preview.
// The Company page preview calls the server (`previewEmail`) so it is the exact send.
import type { Company, Contact, Copy, Data, Settings, Signature } from '../types';

export const VARIABLES = [
  'first_name', 'name', 'role', 'company', 'line', 'opening_title', 'opening_url',
  'pitch_page_url', 'portfolio_url', 'sender_name',
] as const;

export type Level = 'global' | 'company' | 'contact';
export interface Resolved { key: string; label: string; url: string; level: Level; auto_words: string[] }
export type LinkMap = Record<string, Resolved>;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const words = (s: string) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

export const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Links visible to a contact: global, then company, then person (later levels win on the same key). */
export const resolveLinks = (d: Pick<Data, 'links'>, companyId?: string, contactId?: string): LinkMap => {
  const map: LinkMap = {};
  const put = (l: Data['links'][number], level: Level) => {
    if (l.key) map[l.key] = { key: l.key, label: l.label, url: l.url, level, auto_words: words(l.auto_words) };
  };
  d.links.filter((l) => l.scope === 'global').forEach((l) => put(l, 'global'));
  if (companyId) d.links.filter((l) => l.scope === 'company' && l.company_id === companyId).forEach((l) => put(l, 'company'));
  if (contactId) d.links.filter((l) => l.scope === 'contact' && l.contact_id === contactId).forEach((l) => put(l, 'contact'));
  return map;
};

export const usedVars = (text: string): string[] => {
  const found: string[] = [];
  String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, v) => {
    if (!found.includes(v)) found.push(v);
    return m;
  });
  return found;
};

export const usedLinkKeys = (text: string): string[] => {
  const found: string[] = [];
  const add = (m: string, k: string) => { if (!found.includes(k)) found.push(k); return m; };
  String(text || '').replace(/\{\{\s*link:([\w-]+)\s*\}\}/g, add).replace(/href="link:([\w-]+)"/g, add);
  return found;
};

const fill = (text: string, vars: Record<string, string>, escape: boolean) =>
  String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, v) => {
    const val = vars[v] === undefined ? '' : String(vars[v]);
    return escape ? esc(val) : val;
  });

const resolveTokens = (html: string, links: LinkMap, used: Record<string, Resolved>) =>
  html
    .replace(/\{\{\s*link:([\w-]+)\s*\}\}/g, (_m, k: string) => {
      const l = links[k];
      if (!l || !l.url) return '';
      used[k] = l;
      return `<a href="${esc(l.url)}">${esc(l.label)}</a>`;
    })
    .replace(/href="link:([\w-]+)"/g, (_m, k: string) => {
      const l = links[k];
      if (!l || !l.url) return 'href="#"';
      used[k] = l;
      return `href="${esc(l.url)}"`;
    });

/** First whole-word, case-insensitive occurrence of each link's auto words becomes a link (never inside an existing link). */
const autoLink = (html: string, links: LinkMap, used: Record<string, Resolved>) => {
  Object.keys(links).forEach((k) => {
    const l = links[k];
    if (!l.url || !l.auto_words.length || used[k]) return;
    const re = new RegExp('(?<![\\w])(' + [...l.auto_words].sort((a, b) => b.length - a.length).map(escRe).join('|') + ')(?![\\w])', 'i');
    const parts = html.split(/(<[^>]+>)/);
    let depth = 0;
    let done = false;
    for (let i = 0; i < parts.length && !done; i++) {
      const p = parts[i];
      if (/^<a[\s>]/i.test(p)) depth++;
      else if (/^<\/a\s*>/i.test(p)) depth = Math.max(0, depth - 1);
      else if (p.charAt(0) !== '<' && depth === 0) {
        const m = re.exec(p);
        if (m) {
          parts[i] = p.slice(0, m.index) + `<a href="${esc(l.url)}">${m[0]}</a>` + p.slice(m.index + m[0].length);
          done = true;
        }
      }
    }
    if (done) { html = parts.join(''); used[k] = l; }
  });
  return html;
};

export const signatureFor = (copy: Pick<Copy, 'signature_id'>, signatures: Signature[]): Signature | null => {
  if (copy.signature_id === 'none') return null;
  const own = copy.signature_id ? signatures.find((s) => s.id === copy.signature_id) : undefined;
  return own || signatures.find((s) => s.is_default) || null;
};

export interface Sample {
  first_name: string; name: string; role: string; company: string; line: string;
  opening_title: string; opening_url: string; pitch_page_url: string;
}

export const SAMPLE: Sample = {
  first_name: 'Priya', name: 'Priya Sharma', role: 'Head of Product', company: 'Northwind',
  line: 'I liked how your onboarding flow explains pricing before asking for a card.',
  opening_title: 'Senior Product Designer', opening_url: 'https://example.com/careers/design',
  pitch_page_url: 'https://example.com/pitch',
};

export const companyVars = (c: Company, ct: Pick<Contact, 'first_name' | 'name' | 'role'> & { line: string }, s: Settings, links: LinkMap): Record<string, string> => ({
  first_name: ct.first_name || ct.name.split(/\s+/)[0] || '',
  name: ct.name, role: ct.role, company: c.name, line: ct.line,
  opening_title: c.opening_title, opening_url: c.opening_url, pitch_page_url: c.pitch_page_url,
  portfolio_url: links.portfolio?.url || '', sender_name: s.sender_name,
});

export const renderCopy = (
  copy: Pick<Copy, 'subject' | 'body_html' | 'image_url' | 'auto_link' | 'signature_id'>,
  vars: Record<string, string>, links: LinkMap, signatures: Signature[],
) => {
  const sig = signatureFor(copy, signatures);
  const all = `${copy.subject}\n${copy.body_html}\n${sig?.html || ''}`;
  const missing = usedVars(all).filter((v, i, a) => a.indexOf(v) === i && (!(VARIABLES as readonly string[]).includes(v) || !vars[v]));
  usedLinkKeys(all).forEach((k) => { if (!links[k] || !links[k].url) missing.push(`link:${k}`); });

  const used: Record<string, Resolved> = {};
  const subject = fill(copy.subject, vars, false).replace(/\{\{\s*link:([\w-]+)\s*\}\}/g, (_m, k: string) => links[k]?.label || '');
  let body = resolveTokens(fill(copy.body_html, vars, true), links, used);
  if (copy.auto_link) body = autoLink(body, links, used);
  const parts = [body];
  if (copy.image_url) parts.push(`<div><img src="${esc(copy.image_url)}" style="max-width:480px;height:auto;" alt=""></div>`);
  if (sig) {
    let inner = resolveTokens(fill(sig.html, vars, true), links, used);
    if (sig.image_url) inner += `<div style="margin-top:8px"><img src="${esc(sig.image_url)}" style="max-width:480px;height:auto;" alt=""></div>`;
    parts.push(`<div style="margin-top:16px">${inner}</div>`);
  }
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5">${parts.join('\n')}</div>`;
  return { subject, html, missing, used: Object.values(used) };
};

/** Render a signature on its own, for the Signatures tab preview. */
export const renderSignature = (sig: Pick<Signature, 'html' | 'image_url'>, vars: Record<string, string>, links: LinkMap): string => {
  const used: Record<string, Resolved> = {};
  let inner = resolveTokens(fill(sig.html, vars, true), links, used);
  if (sig.image_url) inner += `<div style="margin-top:8px"><img src="${esc(sig.image_url)}" style="max-width:480px;height:auto;" alt=""></div>`;
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5">${inner}</div>`;
};

/** Variables and links a company page can check without knowing the contact. */
export const missingForCompany = (copy: Copy, c: Company, s: Settings, hasLines: boolean, links: LinkMap, signatures: Signature[]): string[] => {
  const probe: Record<string, string> = {
    opening_title: c.opening_title, opening_url: c.opening_url, pitch_page_url: c.pitch_page_url,
    portfolio_url: links.portfolio?.url || '', sender_name: s.sender_name, company: c.name, line: hasLines ? 'x' : '',
  };
  const sig = signatureFor(copy, signatures);
  const all = `${copy.subject}\n${copy.body_html}\n${sig?.html || ''}`;
  const out = usedVars(all).filter((v, i, a) => a.indexOf(v) === i && v in probe && !probe[v]);
  usedLinkKeys(all).forEach((k) => { if (!links[k] || !links[k].url) out.push(`link:${k}`); });
  return out;
};

export const iframeDoc = (html: string): string =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light"><base target="_blank"></head><body style="margin:0;padding:20px">${html}</body></html>`;
