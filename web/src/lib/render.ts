// Client-side mirror of apps-script/Render.gs, used for the live Copies preview.
// The Company page preview calls the server (`previewEmail`) so it is the exact send.
import type { Company, Contact, Copy, Settings } from '../types';

export const VARIABLES = [
  'first_name', 'name', 'role', 'company', 'line', 'opening_title', 'opening_url',
  'pitch_page_url', 'portfolio_url', 'sender_name',
] as const;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const usedVars = (text: string): string[] => {
  const found: string[] = [];
  String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, v) => {
    if (!found.includes(v)) found.push(v);
    return m;
  });
  return found;
};

const fill = (text: string, vars: Record<string, string>, escape: boolean) =>
  String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, v) => {
    const val = vars[v] === undefined ? '' : String(vars[v]);
    return escape ? esc(val) : val;
  });

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

export const companyVars = (c: Company, ct: Pick<Contact, 'first_name' | 'name' | 'role'> & { line: string }, s: Settings): Record<string, string> => ({
  first_name: ct.first_name || ct.name.split(/\s+/)[0] || '',
  name: ct.name, role: ct.role, company: c.name, line: ct.line,
  opening_title: c.opening_title, opening_url: c.opening_url, pitch_page_url: c.pitch_page_url,
  portfolio_url: s.portfolio_url, sender_name: s.sender_name,
});

export const renderCopy = (copy: Pick<Copy, 'subject' | 'body_html' | 'image_url' | 'include_signature'>, vars: Record<string, string>, s: Settings) => {
  const used = usedVars(copy.subject).concat(usedVars(copy.body_html));
  const missing = used.filter((v, i) => used.indexOf(v) === i && (!(VARIABLES as readonly string[]).includes(v) || !vars[v]));
  const body = fill(copy.body_html, vars, true);
  const parts = [body];
  if (copy.image_url) parts.push(`<div><img src="${esc(copy.image_url)}" style="max-width:480px;height:auto;" alt=""></div>`);
  if (copy.include_signature && s.signature_html) parts.push(`<div style="margin-top:16px">${s.signature_html}</div>`);
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5">${parts.join('\n')}</div>`;
  return { subject: fill(copy.subject, vars, false), html, missing };
};

/** Variables a company page can check without knowing the contact. */
export const missingForCompany = (copy: Copy, c: Company, s: Settings, hasLines: boolean): string[] => {
  const probe: Record<string, string> = {
    opening_title: c.opening_title, opening_url: c.opening_url, pitch_page_url: c.pitch_page_url,
    portfolio_url: s.portfolio_url, sender_name: s.sender_name, company: c.name, line: hasLines ? 'x' : '',
  };
  return usedVars(copy.subject).concat(usedVars(copy.body_html))
    .filter((v, i, a) => a.indexOf(v) === i && v in probe && !probe[v]);
};

export const iframeDoc = (html: string): string =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light"><base target="_blank"></head><body style="margin:0;padding:20px">${html}</body></html>`;
