/**
 * Render.gs — template + contact + company → final email (subject, HTML, plain).
 * The same logic is mirrored in web/src/lib/render.ts for the live Copies preview.
 */

var VAR_NAMES = ['first_name', 'name', 'role', 'company', 'line', 'opening_title', 'opening_url', 'pitch_page_url', 'portfolio_url', 'sender_name'];

function escHtml_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function varsFor_(contact, company, S, lineOverride) {
  return {
    first_name: contact.first_name || String(contact.name || '').split(/\s+/)[0] || '',
    name: contact.name || '',
    role: contact.role || '',
    company: company.name || '',
    line: lineOverride !== undefined ? lineOverride : (contact.assigned_line || ''),
    opening_title: company.opening_title || '',
    opening_url: company.opening_url || '',
    pitch_page_url: company.pitch_page_url || '',
    portfolio_url: S.portfolio_url || '',
    sender_name: S.sender_name || ''
  };
}

function usedVars_(text) {
  var found = [];
  String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, function (m, v) {
    if (found.indexOf(v) < 0) found.push(v);
    return m;
  });
  return found;
}

function fill_(text, vars, escape) {
  return String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, function (m, v) {
    var val = vars[v] === undefined ? '' : String(vars[v]);
    return escape ? escHtml_(val) : val;
  });
}

function htmlToPlain_(html) {
  var s = String(html || '');
  s = s.replace(/<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, function (m, href, text) {
    var t = text.replace(/<[^>]+>/g, '');
    return t === href || !href ? t : t + ' (' + href + ')';
  });
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, '');
  s = s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Returns { subject, html, plain, missing[] }. `missing` lists variables that are
 * used by the copy but empty (or unknown); callers must refuse to send when non-empty.
 * opts: { banner: string }  (test mode banner shown at the top)
 */
function renderEmail_(contact, company, copy, S, opts) {
  opts = opts || {};
  var vars = varsFor_(contact, company, S, opts.line);
  var used = usedVars_(copy.subject).concat(usedVars_(copy.body_html));
  var missing = [];
  used.forEach(function (v) {
    if (missing.indexOf(v) < 0 && (VAR_NAMES.indexOf(v) < 0 || !vars[v])) missing.push(v);
  });

  var subject = fill_(copy.subject, vars, false);
  var body = fill_(copy.body_html, vars, true);
  var parts = [body];
  if (copy.image_url) parts.push('<div><img src="' + escHtml_(copy.image_url) + '" style="max-width:480px;height:auto;" alt=""></div>');
  if (copy.include_signature && S.signature_html) parts.push('<div style="margin-top:16px">' + S.signature_html + '</div>');
  var inner = parts.join('\n');
  if (opts.banner) inner = '<div style="margin-bottom:16px;padding:8px 12px;border:1px solid #999;font-size:12px">' + escHtml_(opts.banner) + '</div>' + inner;

  var html = '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5">' + inner + '</div>';
  var plain = (opts.banner ? opts.banner + '\n\n' : '') + htmlToPlain_(body);
  if (copy.include_signature && S.signature_html) plain += '\n\n' + htmlToPlain_(S.signature_html);
  return { subject: subject, html: html, plain: plain, missing: missing };
}

/** Pick the copy a contact should be rendered with (assigned, override, else the company's first). */
function copyFor_(contact, company, kind) {
  var id = kind === 'followup' ? null : (contact.assigned_copy_id || contact.copy_override_id);
  if (id) { var c = byId_('Copies', id); if (c) return c; }
  var ids = csv_(kind === 'followup' ? company.followup_copy_ids : company.copy_ids);
  if (ids.length) {
    var pick = byId_('Copies', ids[Math.floor(Math.random() * ids.length)]);
    if (pick) return pick;
  }
  if (kind === 'followup') {
    var all = where_('Copies', function (c) { return c.kind === 'followup' && !c.archived; });
    return all.length ? all[0] : null;
  }
  return null;
}
