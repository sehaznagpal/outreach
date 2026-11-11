/**
 * Render.gs — template + contact + company → final email (subject, HTML, plain).
 * Order: variables → {{link:key}} / href="link:key" → auto-link words → signature.
 * The same logic is mirrored in web/src/lib/render.ts for the live Content preview.
 */

var VAR_NAMES = ['first_name', 'name', 'role', 'company', 'line', 'opening_title', 'opening_url', 'pitch_page_url', 'portfolio_url', 'sender_name'];

function escHtml_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escRe_(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function slug_(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Links visible to a contact: global, then company, then person (later levels win on the same key). */
function linkMap_(companyId, contactId) {
  var map = {};
  var put = function (l, level) {
    if (!l.key) return;
    map[l.key] = { key: l.key, label: l.label, url: l.url, auto_words: csv_(l.auto_words), level: level };
  };
  where_('Links', function (l) { return l.scope === 'global'; }).forEach(function (l) { put(l, 'global'); });
  if (companyId) where_('Links', function (l) { return l.scope === 'company' && l.company_id === companyId; }).forEach(function (l) { put(l, 'company'); });
  if (contactId) where_('Links', function (l) { return l.scope === 'contact' && l.contact_id === contactId; }).forEach(function (l) { put(l, 'contact'); });
  return map;
}

function varsFor_(contact, company, S, lineOverride, links) {
  return {
    first_name: contact.first_name || String(contact.name || '').split(/\s+/)[0] || '',
    name: contact.name || '',
    role: contact.role || '',
    company: company.name || '',
    line: lineOverride !== undefined ? lineOverride : (contact.assigned_line || ''),
    opening_title: company.opening_title || '',
    opening_url: company.opening_url || '',
    pitch_page_url: company.pitch_page_url || '',
    portfolio_url: links && links.portfolio ? links.portfolio.url : '',
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

/** Link keys referenced explicitly, as {{link:key}} or href="link:key". */
function usedLinkKeys_(text) {
  var found = [];
  var add = function (m, k) { if (found.indexOf(k) < 0) found.push(k); return m; };
  String(text || '').replace(/\{\{\s*link:([\w-]+)\s*\}\}/g, add).replace(/href="link:([\w-]+)"/g, add);
  return found;
}

function fill_(text, vars, escape) {
  return String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, function (m, v) {
    var val = vars[v] === undefined ? '' : String(vars[v]);
    return escape ? escHtml_(val) : val;
  });
}

function resolveLinkTokens_(html, links, used) {
  html = html.replace(/\{\{\s*link:([\w-]+)\s*\}\}/g, function (m, k) {
    var l = links[k];
    if (!l || !l.url) return '';
    used[k] = l;
    return '<a href="' + escHtml_(l.url) + '">' + escHtml_(l.label) + '</a>';
  });
  return html.replace(/href="link:([\w-]+)"/g, function (m, k) {
    var l = links[k];
    if (!l || !l.url) return 'href="#"';
    used[k] = l;
    return 'href="' + escHtml_(l.url) + '"';
  });
}

/** First whole-word, case-insensitive occurrence of each link's auto words becomes a link (never inside an existing link). */
function autoLink_(html, links, used) {
  Object.keys(links).forEach(function (k) {
    var l = links[k];
    if (!l.url || !l.auto_words.length || used[k]) return;
    var words = l.auto_words.slice().sort(function (a, b) { return b.length - a.length; }).map(escRe_);
    var re = new RegExp('(?<![\\w])(' + words.join('|') + ')(?![\\w])', 'i');
    var parts = html.split(/(<[^>]+>)/);
    var depth = 0, done = false;
    for (var i = 0; i < parts.length && !done; i++) {
      var p = parts[i];
      if (/^<a[\s>]/i.test(p)) depth++;
      else if (/^<\/a\s*>/i.test(p)) depth = Math.max(0, depth - 1);
      else if (p.charAt(0) !== '<' && depth === 0) {
        var m = re.exec(p);
        if (m) {
          parts[i] = p.slice(0, m.index) + '<a href="' + escHtml_(l.url) + '">' + m[0] + '</a>' + p.slice(m.index + m[0].length);
          done = true;
        }
      }
    }
    if (done) { html = parts.join(''); used[k] = l; }
  });
  return html;
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

/** The signature a copy uses: its own, the default (blank), or none ("none"). */
function signatureFor_(copy) {
  if (copy.signature_id === 'none') return null;
  if (copy.signature_id) {
    var own = byId_('Signatures', copy.signature_id);
    if (own) return own;
  }
  return where_('Signatures', function (s) { return s.is_default; })[0] || null;
}

/**
 * Returns { subject, html, plain, missing[], links_used[] }. `missing` lists variables or links that are
 * used but empty / unknown; callers must refuse to send when non-empty.
 * opts: { banner: string, line: string }
 */
function renderEmail_(contact, company, copy, S, opts) {
  opts = opts || {};
  var links = linkMap_(company.id, contact.id);
  var vars = varsFor_(contact, company, S, opts.line, links);
  var sig = signatureFor_(copy);
  var sigHtml = sig ? sig.html : '';
  var all = String(copy.subject) + '\n' + String(copy.body_html) + '\n' + sigHtml;

  var missing = [];
  usedVars_(all).forEach(function (v) {
    if (missing.indexOf(v) < 0 && (VAR_NAMES.indexOf(v) < 0 || !vars[v])) missing.push(v);
  });
  usedLinkKeys_(all).forEach(function (k) {
    if (!links[k] || !links[k].url) missing.push('link:' + k);
  });

  var used = {};
  var subject = fill_(copy.subject, vars, false).replace(/\{\{\s*link:([\w-]+)\s*\}\}/g, function (m, k) {
    return links[k] ? links[k].label : '';
  });
  var body = resolveLinkTokens_(fill_(copy.body_html, vars, true), links, used);
  if (copy.auto_link) body = autoLink_(body, links, used);

  var parts = [body];
  if (copy.image_url) parts.push('<div><img src="' + escHtml_(copy.image_url) + '" style="max-width:480px;height:auto;" alt=""></div>');
  var sigRendered = '';
  if (sig) {
    sigRendered = resolveLinkTokens_(fill_(sig.html, vars, true), links, used);
    var sigInner = sigRendered;
    if (sig.image_url) sigInner += '<div style="margin-top:8px"><img src="' + escHtml_(sig.image_url) + '" style="max-width:480px;height:auto;" alt=""></div>';
    parts.push('<div style="margin-top:16px">' + sigInner + '</div>');
  }
  var inner = parts.join('\n');
  if (opts.banner) inner = '<div style="margin-bottom:16px;padding:8px 12px;border:1px solid #999;font-size:12px">' + escHtml_(opts.banner) + '</div>' + inner;

  var html = '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5">' + inner + '</div>';
  var plain = (opts.banner ? opts.banner + '\n\n' : '') + htmlToPlain_(body);
  if (sigRendered) plain += '\n\n' + htmlToPlain_(sigRendered);
  var linksUsed = Object.keys(used).map(function (k) {
    return { key: k, label: used[k].label, url: used[k].url, level: used[k].level };
  });
  return { subject: subject, html: html, plain: plain, missing: missing, links_used: linksUsed };
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
