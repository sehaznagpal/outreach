/**
 * Import.gs — import approved companies from the Scout sheet, then find people and emails
 * with a waterfall: Apollo (search + reveal) → Hunter Email Finder → Hunter Domain Search pattern + Verifier.
 * API keys live in Script Properties: APOLLO_API_KEY and HUNTER_API_KEY.
 */

var SCOUT_SHEET_ID = '14643kPh4A2IzZJQFfs0aUTX-PpXEUMMeARqNWIN7gSs';
var APOLLO_TITLES = ['Product Designer', 'Design Lead', 'Head of Design', 'Founder', 'Co-founder', 'Head of Product', 'HR', 'Talent Acquisition', 'Recruiter'];
var APOLLO_BASE = 'https://api.apollo.io/api/v1/';
var HUNTER_BASE = 'https://api.hunter.io/v2/';
var IMPORT_MAX_MS = 270000; // stay clear of the 6-minute limit

function runDailyImport() {
  try { runImport_('daily'); } catch (e) { console.error('daily import: ' + e); }
}

function importKeys_() {
  var p = PropertiesService.getScriptProperties();
  return { apollo: p.getProperty('APOLLO_API_KEY') || '', hunter: p.getProperty('HUNTER_API_KEY') || '' };
}

// ---------- small helpers ----------

function qs_(params) {
  var out = [];
  Object.keys(params).forEach(function (k) {
    var v = params[k];
    if (Array.isArray(v)) v.forEach(function (x) { out.push(encodeURIComponent(k + '[]') + '=' + encodeURIComponent(x)); });
    else out.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
  });
  return out.join('&');
}

function headerVal_(headers, name) {
  var want = name.toLowerCase();
  for (var k in headers) if (k.toLowerCase() === want) return headers[k];
  return null;
}

function fetchJson_(method, url, headers) {
  var res = UrlFetchApp.fetch(url, { method: method, headers: headers, muteHttpExceptions: true });
  var text = res.getContentText();
  var json = null;
  try { json = JSON.parse(text); } catch (e) { /* not json */ }
  return { code: res.getResponseCode(), json: json, text: text, headers: res.getAllHeaders() };
}

function cleanEmail_(e) {
  e = String(e || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || /not_unlocked/.test(e)) return '';
  return e;
}

function asciiName_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
}

function buildEmail_(pattern, first, last, domain) {
  var f = asciiName_(first), l = asciiName_(last);
  if (!f || !l || !pattern) return '';
  var local = String(pattern).replace(/\{first\}/g, f).replace(/\{last\}/g, l).replace(/\{f\}/g, f.charAt(0)).replace(/\{l\}/g, l.charAt(0));
  if (/[{}]/.test(local)) return '';
  return local + '@' + domain;
}

function toTime_(v) {
  if (v instanceof Date) return v.getTime();
  var t = new Date(String(v)).getTime();
  return isNaN(t) ? Infinity : t;
}

/** Design / product first, then founders, then HR. Anything else (4) is dropped. */
function titlePriority_(title) {
  var t = String(title || '').toLowerCase();
  if (/(design|product)/.test(t) && !/product marketing/.test(t)) return 1;
  if (/(founder|co-founder|cofounder|\bceo\b|chief executive|owner)/.test(t)) return 2;
  if (/(\bhr\b|human resources|talent|recruit|people)/.test(t)) return 3;
  return 4;
}

function withScriptLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { CACHE_ = {}; return fn(); } finally { lock.releaseLock(); }
}

// ---------- Apollo ----------

function apolloHeaders_(keys) {
  return { 'x-api-key': keys.apollo, 'accept': 'application/json', 'Cache-Control': 'no-cache' };
}

/** People search: free, but returns no emails and obfuscated last names. */
function apolloSearch_(domain, keys) {
  var r = fetchJson_('post', APOLLO_BASE + 'mixed_people/api_search?' + qs_({
    q_organization_domains_list: [domain], person_titles: APOLLO_TITLES, include_similar_titles: true, per_page: 25, page: 1
  }), apolloHeaders_(keys));
  if (r.code >= 400) throw new Error('Apollo search ' + r.code + ': ' + String(r.text).slice(0, 120));
  return (r.json && r.json.people) || [];
}

/** Enrichment by id: full name, LinkedIn and work email. Costs 1 credit only when an email comes back. */
function apolloReveal_(id, keys) {
  var r = fetchJson_('post', APOLLO_BASE + 'people/match?' + qs_({ id: id, reveal_personal_emails: false }), apolloHeaders_(keys));
  if (r.code >= 400) throw new Error('Apollo reveal ' + r.code + ': ' + String(r.text).slice(0, 120));
  return (r.json && r.json.person) || null;
}

// ---------- Hunter ----------

function hunterGet_(path, params, keys, usage, estimate) {
  var r = fetchJson_('get', HUNTER_BASE + path + '?' + qs_(params), { 'X-API-KEY': keys.hunter, 'accept': 'application/json' });
  if (r.code === 401 || r.code === 403) throw new Error('Hunter rejected the API key (' + r.code + ')');
  if (r.code === 429) throw new Error('Hunter rate limit or out of credits (429)');
  var used = Number(headerVal_(r.headers, 'X-Credits-Used'));
  if (headerVal_(r.headers, 'X-Credits-Used') !== null && !isNaN(used)) usage.hunter += used;
  else if (r.code < 300) usage.hunter += estimate(r);
  return r;
}

function hunterFind_(domain, first, last, keys, usage) {
  var r = hunterGet_('email-finder', { domain: domain, first_name: first, last_name: last }, keys, usage,
    function (res) { return res.json && res.json.data && res.json.data.email ? 1 : 0; });
  return r.code < 300 && r.json && r.json.data ? cleanEmail_(r.json.data.email) : '';
}

function hunterPattern_(domain, keys, usage) {
  var r = hunterGet_('domain-search', { domain: domain }, keys, usage, function () { return 1; });
  return r.code < 300 && r.json && r.json.data && r.json.data.pattern ? String(r.json.data.pattern) : '';
}

function hunterVerify_(email, keys, usage) {
  for (var i = 0; i < 3; i++) {
    var r = hunterGet_('email-verifier', { email: email }, keys, usage, function () { return 0.5; });
    if (r.code === 202) { Utilities.sleep(2000); continue; }
    return r.json && r.json.data ? String(r.json.data.status) : 'unknown';
  }
  return 'unknown';
}

// ---------- Scout ----------

function readScout_() {
  var ss = SpreadsheetApp.openById(SCOUT_SHEET_ID);
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var values = sheets[i].getDataRange().getValues();
    if (!values.length) continue;
    var head = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
    if (head.indexOf('company') < 0 || head.indexOf('status') < 0 || head.indexOf('website') < 0) continue;
    return values.slice(1).map(function (row, n) {
      var o = { _n: n };
      head.forEach(function (h, c) { if (h) o[h] = row[c]; });
      return o;
    });
  }
  throw new Error('Could not find the Scout table (needs company, status and website columns).');
}

// ---------- one company ----------

/** Finds people and emails for one company. No Sheet writes here, so no lock is held during slow API calls. */
function findPeople_(domain, S, keys, usage, log) {
  var result = { people: [], pattern: '' };
  var ranked = apolloSearch_(domain, keys).map(function (p, i) { return { p: p, i: i, pr: titlePriority_(p.title) }; })
    .filter(function (x) { return x.pr < 4; })
    .sort(function (a, b) { return a.pr - b.pr || a.i - b.i; })
    .slice(0, S.contacts_per_company);

  var pattern = null; // null = not fetched yet, '' = none
  var hunterOn = !!keys.hunter;
  ranked.forEach(function (x) {
    var person = null;
    try { person = apolloReveal_(x.p.id, keys); } catch (e) { log.errors.push(domain + ': ' + e.message); }
    Utilities.sleep(250);
    if (!person) return;
    var first = person.first_name || x.p.first_name || '';
    var last = person.last_name || '';
    var email = cleanEmail_(person.email);
    var source = '';
    if (email) { source = 'apollo'; usage.apollo += 1; }

    if (!email && hunterOn && first && last) {
      try {
        email = hunterFind_(domain, first, last, keys, usage);
        if (email) source = 'hunter';
      } catch (e) { log.errors.push(domain + ': ' + e.message); hunterOn = false; }
    }
    if (!email && hunterOn && first && last) {
      try {
        if (pattern === null) pattern = hunterPattern_(domain, keys, usage);
        var built = pattern ? buildEmail_(pattern, first, last, domain) : '';
        if (built && hunterVerify_(built, keys, usage) === 'valid') { email = built; source = 'pattern+verified'; }
      } catch (e) { log.errors.push(domain + ': ' + e.message); hunterOn = false; }
    }
    result.people.push({
      name: person.name || (first + ' ' + last).trim(), first_name: first, role: person.title || x.p.title || '',
      email: email, email_source: source, linkedin_url: person.linkedin_url || ''
    });
  });
  if (pattern) result.pattern = pattern;
  return result;
}

function saveImported_(row, found) {
  return withScriptLock_(function () {
    var dup = getAll_('Companies').some(function (c) { return cleanDomain_(c.domain) === row._domain || cleanDomain_(c.website) === row._domain; });
    if (dup) return false;
    var notes = [];
    if (row.city) notes.push('City: ' + row.city);
    if (row.sector) notes.push('Sector: ' + row.sector);
    if (row.why_fit) notes.push('Why fit: ' + row.why_fit);
    var now = nowIso_();
    var company = insert_('Companies', {
      name: String(row.company).trim(), industry: String(row.sector || ''), domain: row._domain, website: String(row.website || ''),
      opening_title: '', opening_url: '', pitch_page_url: '', email_pattern: found.pattern ? found.pattern + '@domain' : '',
      notes: notes.join('\n'), copy_ids: '', followup_copy_ids: '', batch_size: 4, followup_after_days: null, max_followups: null,
      status: 'active', created_at: now, replied_at: '', replied_by: '', source: 'scout'
    });
    found.people.forEach(function (p) {
      insert_('Contacts', {
        company_id: company.id, name: p.name, first_name: p.first_name, role: p.role, email: p.email, linkedin_url: p.linkedin_url,
        line_override: '', copy_override_id: '', status: 'draft', assigned_line: '', assigned_copy_id: '', batch_id: '', thread_id: '',
        first_sent_at: '', last_sent_at: '', followups_sent: 0, replied_at: '', created_at: now, type: 'person', email_source: p.email_source
      });
    });
    return true;
  });
}

// ---------- the run ----------

function runImport_(trigger) {
  var userLock = LockService.getUserLock();
  if (!userLock.tryLock(5000)) throw new Error('An import is already running. Try again in a few minutes.');
  var started = Date.now();
  var log = { trigger: trigger, imported: [], skipped: {}, apollo: 0, hunter: 0, pattern: 0, noEmail: 0, waiting: 0, errors: [] };
  var usage = { apollo: 0, hunter: 0 };
  try {
    CACHE_ = {};
    var S = settings_();
    var keys = importKeys_();
    if (!keys.apollo) {
      log.errors.push('APOLLO_API_KEY is not set in Script Properties.');
    } else {
      if (!keys.hunter) log.errors.push('HUNTER_API_KEY is not set, so only Apollo emails were used.');
      var existing = {};
      getAll_('Companies').forEach(function (c) {
        var a = cleanDomain_(c.domain), b = cleanDomain_(c.website);
        if (a) existing[a] = true;
        if (b) existing[b] = true;
      });

      var skip = { 'applied': 0, 'no website': 0, 'already in Companies': 0, 'duplicate in Scout': 0 };
      var eligible = [], seen = {};
      readScout_().forEach(function (r) {
        if (String(r.status).trim().toLowerCase() !== 'approved') return;
        if (/applied/i.test(String(r.history || ''))) { skip['applied']++; return; }
        var domain = cleanDomain_(r.website);
        if (!String(r.company || '').trim() || !domain) { skip['no website']++; return; }
        if (existing[domain]) { skip['already in Companies']++; return; }
        if (seen[domain]) { skip['duplicate in Scout']++; return; }
        seen[domain] = true;
        r._domain = domain;
        r._t = toTime_(r.added_on);
        eligible.push(r);
      });
      eligible.sort(function (a, b) { return a._t === b._t ? a._n - b._n : (a._t < b._t ? -1 : 1); });
      Object.keys(skip).forEach(function (k) { if (skip[k]) log.skipped[k] = skip[k]; });

      var batch = eligible.slice(0, S.import_per_day);
      log.waiting = eligible.length - batch.length;
      for (var i = 0; i < batch.length; i++) {
        if (Date.now() - started > IMPORT_MAX_MS) { log.waiting += batch.length - i; break; }
        var row = batch[i];
        try {
          var found = findPeople_(row._domain, S, keys, usage, log);
          if (!saveImported_(row, found)) { log.skipped['already in Companies'] = (log.skipped['already in Companies'] || 0) + 1; continue; }
          log.imported.push(String(row.company).trim());
          var withEmail = 0;
          found.people.forEach(function (p) {
            if (p.email_source === 'apollo') log.apollo++;
            else if (p.email_source === 'hunter') log.hunter++;
            else if (p.email_source === 'pattern+verified') log.pattern++;
            if (p.email) withEmail++;
          });
          if (!withEmail) log.noEmail++;
        } catch (e) {
          log.errors.push(String(row.company) + ': ' + (e.message || e));
        }
      }
    }
  } catch (e) {
    log.errors.push(String(e.message || e));
  } finally {
    userLock.releaseLock();
  }

  var skippedText = Object.keys(log.skipped).map(function (k) { return k + ': ' + log.skipped[k]; });
  if (log.waiting) skippedText.push('waiting for a later run: ' + log.waiting);
  return withScriptLock_(function () {
    return stripRow_(insert_('ImportLog', {
      run_at: nowIso_(), trigger: trigger, imported: log.imported.length, imported_names: log.imported.join(', '),
      skipped: skippedText.join(', '), emails_apollo: log.apollo, emails_hunter: log.hunter, emails_pattern: log.pattern,
      no_email_companies: log.noEmail,
      credits: 'Apollo ~' + usage.apollo + ' (estimated), Hunter ' + (Math.round(usage.hunter * 10) / 10),
      errors: log.errors.join(' | ')
    }));
  });
}
