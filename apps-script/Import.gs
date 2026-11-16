/**
 * Import.gs — import approved companies from the Scout sheet and create their company pages:
 * name, industry, domain, website, notes (city, sector, why fit, careers link) and a few starter lines.
 * No paid services and no API keys. People and emails are added by hand in the app.
 */

var SCOUT_SHEET_ID = '14643kPh4A2IzZJQFfs0aUTX-PpXEUMMeARqNWIN7gSs';
var IMPORT_MAX_MS = 270000; // stay clear of the 6-minute limit

function runDailyImport() {
  try { runImport_('daily'); } catch (e) { console.error('daily import: ' + e); }
}

// ---------- helpers ----------

function toTime_(v) {
  if (v instanceof Date) return v.getTime();
  var t = new Date(String(v)).getTime();
  return isNaN(t) ? Infinity : t;
}

function withScriptLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { CACHE_ = {}; return fn(); } finally { lock.releaseLock(); }
}

function decodeEntities_(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(Number(n)); }).replace(/\s+/g, ' ').trim();
}

/** What the company says about itself: its homepage meta description, trimmed to a short phrase. */
function siteDescription_(website, domain) {
  try {
    var url = /^https?:\/\//i.test(String(website)) ? String(website).trim() : 'https://' + domain;
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() >= 400) return '';
    var html = res.getContentText().slice(0, 200000);
    var m = /<meta[^>]+(?:name|property)=["'](?:og:)?description["'][^>]*content=["']([^"']+)["']/i.exec(html) ||
      /<meta[^>]+content=["']([^"']+)["'][^>]*(?:name|property)=["'](?:og:)?description["']/i.exec(html);
    var d = m ? decodeEntities_(m[1]) : '';
    if (d.length < 25) return '';
    if (d.length > 110) d = d.slice(0, 110).replace(/\s+\S*$/, '');
    return d.replace(/[.,;:\s]+$/, '');
  } catch (e) { return ''; }
}

// ---------- starter lines ----------

var GENERAL_LINES = [
  "I've been following what {company} is building, and it's the kind of work I'd love to be part of.",
  '{company} stood out to me as a team I would really like to work with.',
  "I'd love to bring a designer's eye to what {company} is building.",
  'The problems {company} is working on are exactly the kind I enjoy designing for.'
];

var SECTOR_LINES = [
  { re: /fintech|financ|payment|bank|insur|lending|crypto|wealth|invest/, lines: [
    'Making money feel simple and trustworthy is a design problem I care about, and {company} is working on it.',
    'Financial products earn trust through small details, which is the kind of design work I enjoy at {company}.'] },
  { re: /health|medic|clinic|bio|care|pharma|wellness|fitness/, lines: [
    'Health products need to feel clear and calm, and that is the kind of design I want to do at {company}.',
    'Good design makes health easier to understand, which is what draws me to {company}.'] },
  { re: /\bai\b|\bml\b|machine learning|llm|data|analytic/, lines: [
    'AI products only work when the interface makes them understandable, which is where I think I can help {company}.',
    'Turning complex data and models into something people can use is the part of design I enjoy most, and {company} is doing that.'] },
  { re: /saas|b2b|enterprise|software|developer|dev tool|platform|cloud|api|security|infra/, lines: [
    'Complex tools that feel simple to use are what I enjoy designing, and {company} looks like it is in that business.',
    'Making powerful software feel easy is a design challenge I would love to take on at {company}.'] },
  { re: /e-?commerce|retail|consumer|marketplace|fashion|food|travel|d2c|shopping/, lines: [
    'Small details in the buying experience make a big difference, and I would love to work on them at {company}.',
    'Great consumer products feel effortless, which is the standard I like to design to and what I see in {company}.'] },
  { re: /edtech|education|learning|school|course|tutor/, lines: [
    'Helping people learn through good design is something I care about, and {company} is working on exactly that.',
    'Learning products succeed when they are clear and encouraging, which is the design work I would love to do at {company}.'] },
  { re: /gaming|game|media|entertain|music|video|creator|social|community/, lines: [
    'Products people enjoy spending time in are the ones I most like designing, and {company} seems to be building one.',
    'Craft and delight matter a lot in what {company} does, and that is where I like to work.'] },
  { re: /logistic|supply|mobility|transport|automotive|\bev\b|climate|energy|sustain|agri/, lines: [
    'Design that makes real-world systems easier to use is what I enjoy most, and {company} works in that space.',
    'The work {company} is doing has real impact, and I would love to help make it easier to use.'] },
  { re: /\bhr\b|recruit|talent|workplace|productivity|collab|people/, lines: [
    'Tools for how people work should feel effortless, and that is the design problem I would love to work on at {company}.',
    'Helping teams work better together is a space I find interesting, and {company} is right in it.'] }
];

function hash_(s) {
  var h = 0;
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100003;
  return h;
}

/** Up to four starter lines: one from the website, up to two for the industry, then general ones. */
function buildLines_(company, sector, description) {
  var out = [];
  var fill = function (t) { return t.replace(/\{company\}/g, company); };
  if (description) out.push('What ' + company + ' says it does, "' + description + '", is exactly the kind of problem I like working on.');
  var s = String(sector || '').toLowerCase();
  SECTOR_LINES.some(function (g) {
    if (!g.re.test(s)) return false;
    g.lines.slice(0, 2).forEach(function (t) { out.push(fill(t)); });
    return true;
  });
  var start = hash_(company) % GENERAL_LINES.length;
  for (var i = 0; i < GENERAL_LINES.length && out.length < 4; i++) {
    var line = fill(GENERAL_LINES[(start + i) % GENERAL_LINES.length]);
    if (out.indexOf(line) < 0) out.push(line);
  }
  return out.slice(0, 4);
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

// ---------- saving ----------

/** Creates the company page and its starter lines. Returns the number of lines, or -1 if the domain already exists. */
function saveImported_(row, description) {
  return withScriptLock_(function () {
    var dup = getAll_('Companies').some(function (c) { return cleanDomain_(c.domain) === row._domain || cleanDomain_(c.website) === row._domain; });
    if (dup) return -1;
    var name = String(row.company).trim();
    var notes = [];
    if (row.city) notes.push('City: ' + row.city);
    if (row.sector) notes.push('Sector: ' + row.sector);
    if (row.why_fit) notes.push('Why fit: ' + row.why_fit);
    if (row.careers_url) notes.push('Careers: ' + row.careers_url);
    var company = insert_('Companies', {
      name: name, industry: String(row.sector || ''), domain: row._domain, website: String(row.website || ''),
      opening_title: '', opening_url: '', pitch_page_url: '', email_pattern: '',
      notes: notes.join('\n'), copy_ids: '', followup_copy_ids: '', batch_size: 4, followup_after_days: null, max_followups: null,
      status: 'active', created_at: nowIso_(), replied_at: '', replied_by: '', source: 'scout'
    });
    var lines = buildLines_(name, row.sector, description);
    lines.forEach(function (t) { insert_('Lines', { company_id: company.id, text: t }); });
    return lines.length;
  });
}

// ---------- the run ----------

function runImport_(trigger) {
  var userLock = LockService.getUserLock();
  if (!userLock.tryLock(5000)) throw new Error('An import is already running. Try again in a few minutes.');
  var started = Date.now();
  var log = { imported: [], skipped: {}, lines: 0, waiting: 0, errors: [] };
  try {
    CACHE_ = {};
    var S = settings_();
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
        var n = saveImported_(row, siteDescription_(row.website, row._domain));
        if (n < 0) { log.skipped['already in Companies'] = (log.skipped['already in Companies'] || 0) + 1; continue; }
        log.imported.push(String(row.company).trim());
        log.lines += n;
      } catch (e) {
        log.errors.push(String(row.company) + ': ' + (e.message || e));
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
      skipped: skippedText.join(', '), lines_added: log.lines, errors: log.errors.join(' | ')
    }));
  });
}
