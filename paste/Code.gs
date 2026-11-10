// ===== Db.gs =====
/**
 * Db.gs — Sheet read/write helpers. The Sheet is the database.
 * Every cell is stored as text (number format "@") so ISO timestamps are never
 * converted into Date cells. Types are restored on read using BOOLS / NUMS.
 */

var TZ = 'Asia/Kolkata';

var SCHEMA = {
  Companies: ['id', 'name', 'industry', 'domain', 'website', 'opening_title', 'opening_url', 'pitch_page_url', 'email_pattern', 'notes', 'copy_ids', 'followup_copy_ids', 'batch_size', 'followup_after_days', 'max_followups', 'status', 'created_at'],
  Contacts: ['id', 'company_id', 'name', 'first_name', 'role', 'email', 'linkedin_url', 'line_override', 'copy_override_id', 'status', 'assigned_line', 'assigned_copy_id', 'batch_id', 'thread_id', 'first_sent_at', 'last_sent_at', 'followups_sent', 'replied_at', 'created_at'],
  Lines: ['id', 'company_id', 'text'],
  Copies: ['id', 'name', 'kind', 'tags', 'subject', 'body_html', 'uses_vars', 'image_url', 'include_signature', 'archived', 'updated_at'],
  Batches: ['id', 'company_id', 'type', 'scheduled_at', 'status', 'contact_ids', 'sent_at', 'created_at'],
  SendLog: ['id', 'contact_id', 'company_id', 'batch_id', 'type', 'copy_id', 'line_used', 'subject', 'sent_at', 'thread_id', 'result', 'error'],
  Roles: ['role'],
  Settings: ['key', 'value']
};

var BOOLS = { include_signature: 1, archived: 1 };
var NUMS = { batch_size: 1, followup_after_days: 1, max_followups: 1, followups_sent: 1 };

var SEED_ROLES = ['Founder', 'Co-founder', 'CEO', 'CTO', 'CPO', 'Chief of Staff', "Founder's Office", 'Head of Product', 'Product Manager', 'Associate Product Manager', 'Head of Design', 'Design Lead', 'Design Manager', 'Product Designer', 'UX Researcher', 'Engineering Manager', 'Hiring Manager', 'HR', 'HR Business Partner', 'Talent Acquisition', 'Recruiter', 'Other'];

var DEFAULT_SETTINGS = {
  daily_cap: '15',
  send_days: 'Mon,Tue,Wed,Thu,Fri',
  default_send_time: '10:30',
  followup_after_days: '4',
  max_followups: '1',
  signature_html: '',
  sender_name: 'Sehaz',
  portfolio_url: '',
  test_mode: 'true',
  test_email: '',
  paused: 'false',
  weekly_goal_companies: '5'
};

var CACHE_ = {};

// ---------- small utils ----------

function uid_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 10);
}

function isoFromDate_(d) {
  return Utilities.formatDate(d, TZ, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function nowIso_() {
  return isoFromDate_(new Date());
}

function dateOf_(iso) {
  return String(iso || '').slice(0, 10);
}

/** Accepts 'yyyy-MM-ddTHH:mm' from the UI or a full ISO string; returns a full IST ISO string. */
function normalizeIso_(s) {
  s = String(s || '');
  if (s.length === 16) return s + ':00+05:30';
  if (s.length === 19) return s + '+05:30';
  return isoFromDate_(new Date(s));
}

function csv_(s) {
  return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
}

function toStr_(v) {
  if (v === null || v === undefined) return '';
  if (v === true) return 'true';
  if (v === false) return 'false';
  return String(v);
}

function fromCell_(col, v) {
  if (BOOLS[col]) return v === true || String(v).toLowerCase() === 'true';
  if (NUMS[col]) { return v === '' || v === null || v === undefined ? null : Number(v); }
  return v === null || v === undefined ? '' : String(v);
}

// ---------- spreadsheet access ----------

function ss_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('SHEET_ID is not set in Script Properties');
  return SpreadsheetApp.openById(id);
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Missing tab "' + name + '". Run setup() once from the Apps Script editor.');
  return sh;
}

function getAll_(name) {
  if (CACHE_[name]) return CACHE_[name];
  var sh = sheet_(name);
  var cols = SCHEMA[name];
  var last = sh.getLastRow();
  var rows = [];
  if (last > 1) {
    var values = sh.getRange(2, 1, last - 1, cols.length).getValues();
    for (var i = 0; i < values.length; i++) {
      var o = { _row: i + 2 };
      for (var c = 0; c < cols.length; c++) o[cols[c]] = fromCell_(cols[c], values[i][c]);
      if (name === 'Roles' ? !o.role : !o.id && !o.key) continue;
      rows.push(o);
    }
  }
  CACHE_[name] = rows;
  return rows;
}

function stripRow_(o) {
  var out = {};
  for (var k in o) if (k !== '_row') out[k] = o[k];
  return out;
}

function toRow_(name, o) {
  return SCHEMA[name].map(function (c) { return toStr_(o[c]); });
}

function byId_(name, id) {
  var rows = getAll_(name);
  for (var i = 0; i < rows.length; i++) if (rows[i].id === id) return rows[i];
  return null;
}

function insert_(name, o) {
  // clients may supply their own id (optimistic UI); keep it only if it looks sane and is unused
  if (o.id && (!/^[a-z0-9]{6,12}$/.test(o.id) || byId_(name, o.id))) o.id = '';
  if (!o.id && name !== 'Roles') o.id = uid_();
  var sh = sheet_(name);
  sh.appendRow(toRow_(name, o));
  o._row = sh.getLastRow();
  getAll_(name).push(o);
  return o;
}

/** Merge `patch` into the row with this id and write it back. */
function update_(name, id, patch) {
  var o = byId_(name, id);
  if (!o) throw new Error(name + ' ' + id + ' not found');
  for (var k in patch) if (SCHEMA[name].indexOf(k) >= 0 && k !== 'id') o[k] = patch[k];
  sheet_(name).getRange(o._row, 1, 1, SCHEMA[name].length).setValues([toRow_(name, o)]);
  return o;
}

function remove_(name, id) {
  var o = byId_(name, id);
  if (!o) return;
  sheet_(name).deleteRow(o._row);
  delete CACHE_[name]; // row numbers shifted
}

function where_(name, fn) {
  return getAll_(name).filter(fn);
}

// ---------- settings ----------

function rawSettings_() {
  var out = {};
  for (var k in DEFAULT_SETTINGS) out[k] = DEFAULT_SETTINGS[k];
  getAll_('Settings').forEach(function (r) { out[r.key] = r.value; });
  return out;
}

/** Parsed settings. */
function settings_() {
  var r = rawSettings_();
  var days = csv_(r.send_days);
  return {
    daily_cap: Number(r.daily_cap) || 15,
    send_days: days.length ? days : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    default_send_time: /^\d{2}:\d{2}$/.test(r.default_send_time) ? r.default_send_time : '10:30',
    followup_after_days: Number(r.followup_after_days) || 4,
    max_followups: r.max_followups === '' ? 1 : Number(r.max_followups),
    signature_html: r.signature_html || '',
    sender_name: r.sender_name || '',
    portfolio_url: r.portfolio_url || '',
    test_mode: String(r.test_mode) === 'true',
    test_email: r.test_email || '',
    paused: String(r.paused) === 'true',
    weekly_goal_companies: Number(r.weekly_goal_companies) || 5
  };
}

function saveSetting_(key, value) {
  var rows = getAll_('Settings');
  var v = Array.isArray(value) ? value.join(',') : toStr_(value);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].key === key) {
      rows[i].value = v;
      sheet_('Settings').getRange(rows[i]._row, 1, 1, 2).setValues([[key, v]]);
      return;
    }
  }
  var sh = sheet_('Settings');
  sh.appendRow([key, v]);
  rows.push({ _row: sh.getLastRow(), key: key, value: v });
}

// ---------- deltas: what changed, returned to the client ----------

function newDelta_() {
  return { upsert: {}, remove: {} };
}

function dUp_(delta, name, row) {
  if (!delta.upsert[name]) delta.upsert[name] = [];
  var list = delta.upsert[name];
  var clean = stripRow_(row);
  for (var i = 0; i < list.length; i++) if (list[i].id === clean.id) { list[i] = clean; return; }
  list.push(clean);
}

function dRm_(delta, name, id) {
  if (!delta.remove[name]) delta.remove[name] = [];
  delta.remove[name].push(id);
  if (delta.upsert[name]) delta.upsert[name] = delta.upsert[name].filter(function (r) { return r.id !== id; });
}

// ===== Render.gs =====
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

// ===== Scheduler.gs =====
/**
 * Scheduler.gs — batch planning, cap checks, ready → batch placement, follow-up scheduling.
 * All dates are 'yyyy-MM-dd' strings in Asia/Kolkata (no DST, fixed +05:30).
 */

// ---------- date helpers ----------

function dow_(dateStr) {
  return Utilities.formatDate(new Date(dateStr + 'T12:00:00+05:30'), TZ, 'EEE');
}

function addDays_(dateStr, n) {
  var d = new Date(dateStr + 'T12:00:00+05:30');
  d.setTime(d.getTime() + n * 86400000);
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

function isSendDay_(dateStr, S) {
  return S.send_days.indexOf(dow_(dateStr)) >= 0;
}

function nextSendDay_(dateStr, S, inclusive) {
  var d = inclusive ? dateStr : addDays_(dateStr, 1);
  for (var i = 0; i < 14; i++) {
    if (isSendDay_(d, S)) return d;
    d = addDays_(d, 1);
  }
  return d;
}

function atTime_(dateStr, time) {
  return dateStr + 'T' + time + ':00+05:30';
}

// ---------- assignment ----------

function pickEven_(options, used) {
  if (!options.length) return '';
  var counts = options.map(function (o) { return used.filter(function (u) { return u === o; }).length; });
  var min = Math.min.apply(null, counts);
  var pool = options.filter(function (o, i) { return counts[i] === min; });
  return pool[Math.floor(Math.random() * pool.length)];
}

function companyLines_(companyId) {
  return where_('Lines', function (l) { return l.company_id === companyId; }).map(function (l) { return l.text; });
}

/** Assign a line (and copy, when asked) to a contact, spreading evenly within the company. */
function assignLine_(c) {
  if (c.line_override) return c.line_override;
  var used = where_('Contacts', function (o) { return o.company_id === c.company_id && o.id !== c.id && o.assigned_line; })
    .map(function (o) { return o.assigned_line; });
  return pickEven_(companyLines_(c.company_id), used);
}

function assignCopyId_(c, company) {
  if (c.copy_override_id) return c.copy_override_id;
  var ids = csv_(company.copy_ids).filter(function (id) { return byId_('Copies', id); });
  var used = where_('Contacts', function (o) { return o.company_id === c.company_id && o.id !== c.id && o.assigned_copy_id; })
    .map(function (o) { return o.assigned_copy_id; });
  return pickEven_(ids, used);
}

// ---------- batches ----------

function companyFirstBatchDates_(companyId) {
  var out = {};
  where_('Batches', function (b) { return b.company_id === companyId && b.type === 'first' && b.status !== 'cancelled'; })
    .forEach(function (b) { out[dateOf_(b.scheduled_at)] = true; });
  return out;
}

function placeInBatch_(contact, company, S, delta) {
  var now = nowIso_();
  var size = company.batch_size || 4;
  var open = where_('Batches', function (b) {
    return b.company_id === company.id && b.type === 'first' && b.status === 'planned' && b.scheduled_at > now && csv_(b.contact_ids).length < size;
  }).sort(function (a, b) { return a.scheduled_at < b.scheduled_at ? -1 : 1; });

  var batch;
  if (open.length) {
    batch = open[0];
    var ids = csv_(batch.contact_ids);
    ids.push(contact.id);
    batch = update_('Batches', batch.id, { contact_ids: ids.join(',') });
  } else {
    var dates = Object.keys(companyFirstBatchDates_(company.id)).sort();
    var today = dateOf_(now);
    var candidate = nextSendDay_(today, S, true);
    while (atTime_(candidate, S.default_send_time) <= now) candidate = nextSendDay_(candidate, S, false);
    if (dates.length) {
      var after = nextSendDay_(dates[dates.length - 1], S, false);
      if (after > candidate) candidate = after;
    }
    batch = insert_('Batches', {
      company_id: company.id, type: 'first', scheduled_at: atTime_(candidate, S.default_send_time),
      status: 'planned', contact_ids: contact.id, sent_at: '', created_at: now
    });
  }
  dUp_(delta, 'Batches', batch);
  return batch;
}

function dropContactFromBatch_(batchId, contactId, delta) {
  var b = byId_('Batches', batchId);
  if (!b) return;
  var ids = csv_(b.contact_ids).filter(function (x) { return x !== contactId; });
  if (!ids.length && b.status === 'planned') {
    remove_('Batches', b.id);
    dRm_(delta, 'Batches', b.id);
  } else {
    dUp_(delta, 'Batches', update_('Batches', b.id, { contact_ids: ids.join(',') }));
  }
}

/** Mark contacts ready (placing them in batches) or un-ready them. */
function setReady_(ids, ready) {
  var S = settings_();
  var delta = newDelta_();
  var errors = [];
  ids.forEach(function (id) {
    var c = byId_('Contacts', id);
    if (!c) return;
    var company = byId_('Companies', c.company_id);
    if (!company) return;

    if (!ready) {
      if (c.status !== 'ready' && c.status !== 'scheduled') return;
      if (c.batch_id) dropContactFromBatch_(c.batch_id, c.id, delta);
      dUp_(delta, 'Contacts', update_('Contacts', c.id, { status: 'draft', assigned_line: '', assigned_copy_id: '', batch_id: '' }));
      return;
    }

    if (c.status !== 'draft') return;
    if (!c.email) { errors.push({ contact_id: c.id, message: 'No email address.' }); return; }
    var copyId = assignCopyId_(c, company);
    if (!copyId) { errors.push({ contact_id: c.id, message: 'Pick at least one copy for this company first.' }); return; }
    var line = assignLine_(c);
    var copy = byId_('Copies', copyId);
    var probe = renderEmail_(c, company, copy, S, { line: line });
    if (probe.missing.length) {
      errors.push({ contact_id: c.id, message: 'Missing ' + probe.missing.map(function (v) { return '{{' + v + '}}'; }).join(', ') + '.' });
      return;
    }
    update_('Contacts', c.id, { status: 'ready', assigned_line: line, assigned_copy_id: copyId });
    var batch = placeInBatch_(c, company, S, delta);
    dUp_(delta, 'Contacts', update_('Contacts', c.id, { status: 'scheduled', batch_id: batch.id }));
  });
  return { delta: delta, errors: errors };
}

function removeFromBatch_(batchId, contactId) {
  var delta = newDelta_();
  var b = byId_('Batches', batchId);
  var c = byId_('Contacts', contactId);
  if (!b) throw new Error('Batch not found');
  if (b.status !== 'planned') throw new Error('Only planned batches can be changed');
  dropContactFromBatch_(batchId, contactId, delta);
  if (c) {
    var patch = b.type === 'first' ? { status: 'ready', batch_id: '' } : { batch_id: '' };
    dUp_(delta, 'Contacts', update_('Contacts', c.id, patch));
  }
  return { delta: delta };
}

function cancelBatch_(batchId) {
  var delta = newDelta_();
  var b = byId_('Batches', batchId);
  if (!b) throw new Error('Batch not found');
  if (b.status !== 'planned') throw new Error('Only planned batches can be cancelled');
  csv_(b.contact_ids).forEach(function (cid) {
    var c = byId_('Contacts', cid);
    if (!c || c.batch_id !== b.id) return;
    var patch = b.type === 'first' ? { status: 'ready', batch_id: '' } : { batch_id: '' };
    dUp_(delta, 'Contacts', update_('Contacts', c.id, patch));
  });
  dUp_(delta, 'Batches', update_('Batches', b.id, { status: 'cancelled' }));
  return { delta: delta };
}

function rescheduleBatch_(batchId, scheduledAt) {
  var delta = newDelta_();
  var b = byId_('Batches', batchId);
  if (!b) throw new Error('Batch not found');
  if (b.status !== 'planned') throw new Error('Only planned batches can be rescheduled');
  dUp_(delta, 'Batches', update_('Batches', b.id, { scheduled_at: normalizeIso_(scheduledAt) }));
  return { delta: delta };
}

/** Total emails planned or sent on a date (batches only; used for cap warnings). */
function dayLoad_(dateStr) {
  var n = 0;
  getAll_('Batches').forEach(function (b) {
    if (b.status === 'cancelled' || dateOf_(b.scheduled_at) !== dateStr) return;
    n += csv_(b.contact_ids).length;
  });
  return n;
}

/**
 * planBatches: create batches for ready-but-unscheduled contacts of the chosen companies.
 * spacing: 'daily' (every send day) | 'every2' (every 2nd send day).
 */
function planBatches_(companyIds, start, time, spacing, dryRun) {
  var S = settings_();
  var now = nowIso_();
  var step = spacing === 'every2' ? 2 : 1;
  var advance = function (d) { for (var i = 0; i < step; i++) d = nextSendDay_(d, S, false); return d; };
  var plan = [];
  var added = {};

  companyIds.forEach(function (cid) {
    var company = byId_('Companies', cid);
    if (!company) return;
    var ready = where_('Contacts', function (c) { return c.company_id === cid && c.status === 'ready' && !c.batch_id; });
    if (!ready.length) return;
    var size = company.batch_size || 4;
    var taken = companyFirstBatchDates_(cid);
    var d = nextSendDay_(start, S, true);
    while (atTime_(d, time) <= now) d = nextSendDay_(d, S, false);
    for (var i = 0; i < ready.length; i += size) {
      while (taken[d]) d = advance(d);
      var chunk = ready.slice(i, i + size);
      plan.push({
        company_id: cid, company_name: company.name, date: d, scheduled_at: atTime_(d, time),
        contact_ids: chunk.map(function (c) { return c.id; }), names: chunk.map(function (c) { return c.name; })
      });
      taken[d] = true;
      added[d] = (added[d] || 0) + chunk.length;
      d = advance(d);
    }
  });

  var days = Object.keys(added).sort().map(function (d) {
    var total = dayLoad_(d) + added[d];
    return { date: d, total: total, cap: S.daily_cap, over_cap: total > S.daily_cap };
  });
  if (dryRun) return { plan: plan, days: days };

  var delta = newDelta_();
  plan.forEach(function (p) {
    var batch = insert_('Batches', {
      company_id: p.company_id, type: 'first', scheduled_at: p.scheduled_at, status: 'planned',
      contact_ids: p.contact_ids.join(','), sent_at: '', created_at: now
    });
    dUp_(delta, 'Batches', batch);
    p.contact_ids.forEach(function (id) {
      dUp_(delta, 'Contacts', update_('Contacts', id, { status: 'scheduled', batch_id: batch.id }));
    });
  });
  return { plan: plan, days: days, delta: delta };
}

// ---------- follow-ups ----------

/** After an email is sent, queue the next follow-up (or clear the batch pointer when none is due). */
function scheduleFollowup_(contact, company, S, fromIso) {
  var done = contact.followups_sent || 0;
  var max = company.max_followups !== null ? company.max_followups : S.max_followups;
  if (done >= max) {
    update_('Contacts', contact.id, { batch_id: '' });
    return;
  }
  var days = company.followup_after_days || S.followup_after_days;
  var date = nextSendDay_(addDays_(dateOf_(fromIso), days), S, true);
  var existing = where_('Batches', function (b) {
    return b.company_id === company.id && b.type === 'followup' && b.status === 'planned' && dateOf_(b.scheduled_at) === date;
  })[0];
  var batch;
  if (existing) {
    var ids = csv_(existing.contact_ids);
    ids.push(contact.id);
    batch = update_('Batches', existing.id, { contact_ids: ids.join(',') });
  } else {
    batch = insert_('Batches', {
      company_id: company.id, type: 'followup', scheduled_at: atTime_(date, S.default_send_time),
      status: 'planned', contact_ids: contact.id, sent_at: '', created_at: nowIso_()
    });
  }
  update_('Contacts', contact.id, { batch_id: batch.id });
}

/** Cancel any pending follow-up for this contact. */
function cancelFollowups_(contact) {
  if (!contact.batch_id) return;
  var b = byId_('Batches', contact.batch_id);
  if (b && b.type === 'followup' && b.status === 'planned') dropContactFromBatch_(b.id, contact.id, newDelta_());
  update_('Contacts', contact.id, { batch_id: '' });
}

// ===== Sender.gs =====
/**
 * Sender.gs — the 10-minute trigger: send due batches, then check the inbox.
 */

function runTrigger() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return;
  try {
    var S = settings_();
    if (S.paused) return;
    sendDue_(S);
    checkInbox_(S);
  } finally {
    lock.releaseLock();
  }
}

function logSend_(c, batch, type, copyId, line, subject, threadId, result, error) {
  insert_('SendLog', {
    contact_id: c.id, company_id: c.company_id, batch_id: batch.id, type: type, copy_id: copyId || '',
    line_used: line || '', subject: subject || '', sent_at: nowIso_(), thread_id: threadId || '',
    result: result, error: error || ''
  });
}

function alreadyContacted_(c) {
  var email = String(c.email).toLowerCase();
  return getAll_('Contacts').some(function (o) {
    return o.id !== c.id && String(o.email).toLowerCase() === email &&
      ['sent', 'followed_up', 'replied', 'bounced'].indexOf(o.status) >= 0;
  });
}

function alreadyTested_(batchId, contactId) {
  return getAll_('SendLog').some(function (r) { return r.batch_id === batchId && r.contact_id === contactId && r.result === 'test'; });
}

function findThreadId_(to, subject) {
  var q = 'to:' + to + ' subject:"' + subject.replace(/"/g, '') + '" newer_than:1d';
  for (var i = 0; i < 2; i++) {
    var found = GmailApp.search(q, 0, 1);
    if (found.length) return found[0].getId();
    Utilities.sleep(2000);
  }
  return '';
}

/** Sends one email. Returns true on success (or a test send), false on error (already logged). */
function sendOne_(batch, c, company, S) {
  var isFollowup = batch.type === 'followup';
  var type = isFollowup ? 'followup_' + ((c.followups_sent || 0) + 1) : 'first';
  var copy = copyFor_(c, company, isFollowup ? 'followup' : 'first');
  try {
    if (!copy) throw new Error(isFollowup ? 'No follow-up copy available' : 'No copy available');
    if (isFollowup && !c.thread_id && !S.test_mode) throw new Error('No thread to reply to');
    var banner = S.test_mode ? 'Test mode. This would have gone to ' + c.name + ' <' + c.email + '>.' : '';
    var r = renderEmail_(c, company, copy, S, { banner: banner });
    if (r.missing.length) throw new Error('Missing variable: ' + r.missing.join(', '));

    if (S.test_mode) {
      if (!S.test_email) throw new Error('Test mode is on but test_email is not set');
      GmailApp.sendEmail(S.test_email, (isFollowup ? '[Follow-up] ' : '') + r.subject, r.plain, { htmlBody: r.html, name: S.sender_name });
      logSend_(c, batch, type, copy.id, c.assigned_line, r.subject, '', 'test', '');
      return true;
    }

    var threadId = c.thread_id;
    var subject = r.subject;
    if (isFollowup) {
      var thread = GmailApp.getThreadById(c.thread_id);
      if (!thread) throw new Error('Thread not found');
      subject = thread.getFirstMessageSubject();
      thread.reply(r.plain, { htmlBody: r.html, name: S.sender_name });
    } else {
      GmailApp.sendEmail(c.email, r.subject, r.plain, { htmlBody: r.html, name: S.sender_name });
      threadId = findThreadId_(c.email, r.subject);
    }
    var now = nowIso_();
    if (isFollowup) {
      c = update_('Contacts', c.id, { status: 'followed_up', followups_sent: (c.followups_sent || 0) + 1, last_sent_at: now });
    } else {
      c = update_('Contacts', c.id, { status: 'sent', first_sent_at: now, last_sent_at: now, thread_id: threadId, assigned_copy_id: copy.id });
    }
    logSend_(c, batch, type, copy.id, c.assigned_line, subject, threadId, 'ok', '');
    scheduleFollowup_(c, company, S, now);
    return true;
  } catch (err) {
    logSend_(c, batch, type, copy ? copy.id : '', c.assigned_line, '', '', 'error', String(err.message || err));
    return false;
  }
}

function sendDue_(S) {
  var now = nowIso_();
  var today = dateOf_(now);
  var due = where_('Batches', function (b) { return b.status === 'planned' && b.scheduled_at <= now; })
    .sort(function (a, b) { return a.scheduled_at < b.scheduled_at ? -1 : 1; });
  var okToday = where_('SendLog', function (r) { return r.result === 'ok' && dateOf_(r.sent_at) === today; }).length;
  var capHit = false;

  due.forEach(function (batch) {
    var company = byId_('Companies', batch.company_id);
    if (!company || company.status === 'paused' || company.status === 'done') {
      if (!company) update_('Batches', batch.id, { status: 'cancelled' });
      return;
    }
    var sent = 0, errors = 0, remaining = 0;

    csv_(batch.contact_ids).forEach(function (id) {
      var c = byId_('Contacts', id);
      var eligible = c && c.batch_id === batch.id && !c.replied_at &&
        (batch.type === 'first' ? c.status === 'scheduled' : (c.status === 'sent' || c.status === 'followed_up'));
      if (!eligible) return;

      if (S.test_mode) {
        if (!alreadyTested_(batch.id, c.id)) sendOne_(batch, c, company, S);
        return;
      }
      if (okToday >= S.daily_cap) { capHit = true; remaining++; return; }
      if (batch.type === 'first' && alreadyContacted_(c)) {
        logSend_(c, batch, 'first', '', '', '', '', 'error', 'Email already contacted');
        update_('Contacts', c.id, { status: 'stopped', batch_id: '' });
        errors++;
        return;
      }
      if (sendOne_(batch, c, company, S)) { sent++; okToday++; }
      else {
        errors++;
        // send the contact back to Ready so it can be re-planned once fixed
        if (batch.type === 'first') update_('Contacts', c.id, { status: 'ready', batch_id: '' });
      }
    });

    if (S.test_mode || remaining > 0) return; // batch stays planned
    var status = sent === 0 && errors === 0 ? 'cancelled' : (errors > 0 ? 'partial' : 'sent');
    update_('Batches', batch.id, { status: status, sent_at: now });
  });

  if (capHit) saveSetting_('cap_hit_date', today);
}

// ===== Inbox.gs =====
/**
 * Inbox.gs — reply + bounce detection. Runs from the same trigger, after sending.
 */

function checkInbox_(S) {
  try { checkReplies_(); } catch (e) { console.error('replies: ' + e); }
  try { checkBounces_(); } catch (e) { console.error('bounces: ' + e); }
}

function checkReplies_() {
  var me = Session.getEffectiveUser().getEmail().toLowerCase();
  var cutoff = isoFromDate_(new Date(Date.now() - 30 * 86400000));
  var open = where_('Contacts', function (c) {
    return (c.status === 'sent' || c.status === 'followed_up') && c.thread_id && c.first_sent_at >= cutoff;
  });
  open.forEach(function (c) {
    var thread = GmailApp.getThreadById(c.thread_id);
    if (!thread) return;
    var reply = null;
    thread.getMessages().forEach(function (m) {
      var from = m.getFrom().toLowerCase();
      if (from.indexOf(me) >= 0 || /mailer-daemon|postmaster/.test(from)) return;
      if (!reply) reply = m;
    });
    if (!reply) return;
    cancelFollowups_(c);
    update_('Contacts', c.id, { status: 'replied', replied_at: isoFromDate_(reply.getDate()), batch_id: '' });
  });
}

function checkBounces_() {
  var open = where_('Contacts', function (c) { return c.status === 'sent' || c.status === 'followed_up'; });
  if (!open.length) return;
  GmailApp.search('from:mailer-daemon newer_than:2d', 0, 20).forEach(function (thread) {
    thread.getMessages().forEach(function (m) {
      var body = (m.getPlainBody() || '').toLowerCase();
      open.forEach(function (c) {
        var fresh = byId_('Contacts', c.id);
        if (fresh.status === 'bounced' || !fresh.email) return;
        if (body.indexOf(String(fresh.email).toLowerCase()) >= 0) {
          cancelFollowups_(fresh);
          update_('Contacts', fresh.id, { status: 'bounced', batch_id: '' });
        }
      });
    });
  });
}

// ===== Api.gs =====
/**
 * Api.gs — doPost router + token check, plus setup().
 * Request:  { token, action, payload }   Response: { ok, data | error }
 */

function doGet() {
  return out_({ ok: true, data: 'Outreach API. Use POST.' });
}

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    var expected = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
    if (!expected || !req.token || req.token !== expected) return out_({ ok: false, error: 'Unauthorized' });
    var entry = ACTIONS[req.action];
    if (!entry) return out_({ ok: false, error: 'Unknown action: ' + req.action });

    var lock = null;
    if (entry.write) {
      lock = LockService.getScriptLock();
      lock.waitLock(25000);
    }
    try {
      CACHE_ = {};
      return out_({ ok: true, data: entry.fn(req.payload || {}) });
    } finally {
      if (lock) lock.releaseLock();
    }
  } catch (err) {
    return out_({ ok: false, error: String((err && err.message) || err) });
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function rows_(name, filter) {
  var r = getAll_(name);
  if (filter) r = r.filter(filter);
  return r.map(stripRow_);
}

function csvOf_(v) {
  return Array.isArray(v) ? v.join(',') : toStr_(v);
}

function sheetUrl_() {
  try { return ss_().getUrl(); } catch (e) { return ''; }
}

// ---------- read actions ----------

function bootstrap_() {
  var since = isoFromDate_(new Date(Date.now() - 120 * 86400000));
  var raw = rawSettings_();
  return {
    settings: settings_(),
    roles: getAll_('Roles').map(function (r) { return r.role; }),
    companies: rows_('Companies'),
    contacts: rows_('Contacts'),
    lines: rows_('Lines'),
    copies: rows_('Copies'),
    batches: rows_('Batches', function (b) { return b.status === 'planned' || b.scheduled_at >= since; }),
    sendlog: rows_('SendLog', function (r) { return r.sent_at >= since; }),
    meta: {
      sheet_url: sheetUrl_(),
      me: Session.getEffectiveUser().getEmail(),
      server_time: nowIso_(),
      cap_hit_date: raw.cap_hit_date || ''
    }
  };
}

function getCompany_(p) {
  var company = byId_('Companies', p.id);
  if (!company) throw new Error('Company not found');
  return {
    company: stripRow_(company),
    contacts: rows_('Contacts', function (c) { return c.company_id === p.id; }),
    lines: rows_('Lines', function (l) { return l.company_id === p.id; }),
    batches: rows_('Batches', function (b) { return b.company_id === p.id; })
  };
}

function listBatches_(p) {
  var from = p.from || '0000-00-00', to = p.to || '9999-99-99';
  return { batches: rows_('Batches', function (b) { var d = dateOf_(b.scheduled_at); return d >= from && d <= to; }) };
}

function getCalendar_(p) {
  var month = p.month; // 'yyyy-MM'
  var inMonth = function (iso) { return String(iso).slice(0, 7) === month; };
  return {
    sendlog: rows_('SendLog', function (r) { return inMonth(r.sent_at) && r.result === 'ok'; }),
    batches: rows_('Batches', function (b) { return inMonth(b.scheduled_at); })
  };
}

function previewEmail_(p) {
  var S = settings_();
  var c = byId_('Contacts', p.contact_id);
  if (!c) throw new Error('Contact not found');
  var company = byId_('Companies', c.company_id);
  var copy = p.copy_id ? byId_('Copies', p.copy_id) : null;
  if (!copy) {
    var firstId = csv_(company.copy_ids)[0];
    copy = (c.assigned_copy_id && byId_('Copies', c.assigned_copy_id)) ||
      (c.copy_override_id && byId_('Copies', c.copy_override_id)) ||
      (firstId && byId_('Copies', firstId));
  }
  if (!copy) throw new Error('This company has no copy selected yet.');
  var line = c.assigned_line || c.line_override || companyLines_(company.id)[0] || '';
  var r = renderEmail_(c, company, copy, S, { line: line });
  r.to = c.email;
  r.copy_id = copy.id;
  return r;
}

function sendTest_(p) {
  var S = settings_();
  var r = previewEmail_(p);
  if (r.missing.length) throw new Error('Missing ' + r.missing.map(function (v) { return '{{' + v + '}}'; }).join(', '));
  var to = S.test_email || Session.getEffectiveUser().getEmail();
  var banner = 'Test email. Real recipient would be ' + r.to + '.';
  var c = byId_('Contacts', p.contact_id);
  var company = byId_('Companies', c.company_id);
  var copy = byId_('Copies', r.copy_id);
  var line = c.assigned_line || c.line_override || companyLines_(company.id)[0] || '';
  var withBanner = renderEmail_(c, company, copy, S, { line: line, banner: banner });
  GmailApp.sendEmail(to, withBanner.subject, withBanner.plain, { htmlBody: withBanner.html, name: S.sender_name });
  return { sent_to: to };
}

// ---------- write actions ----------

var COMPANY_FIELDS = ['name', 'industry', 'domain', 'website', 'opening_title', 'opening_url', 'pitch_page_url', 'email_pattern', 'notes', 'copy_ids', 'followup_copy_ids', 'batch_size', 'followup_after_days', 'max_followups', 'status'];

function saveCompany_(p) {
  var c = p.company || {};
  var patch = {};
  COMPANY_FIELDS.forEach(function (f) {
    if (c[f] === undefined) return;
    patch[f] = (f === 'copy_ids' || f === 'followup_copy_ids') ? csvOf_(c[f]) : c[f];
  });
  var delta = newDelta_();
  var row;
  if (c.id) {
    row = update_('Companies', c.id, patch);
  } else {
    if (!patch.name) throw new Error('Company name is required');
    row = insert_('Companies', {
      name: patch.name, industry: patch.industry || '', domain: patch.domain || '', website: patch.website || '',
      opening_title: '', opening_url: '', pitch_page_url: '', email_pattern: '', notes: '',
      copy_ids: '', followup_copy_ids: '', batch_size: 4, followup_after_days: null, max_followups: null,
      status: 'active', created_at: nowIso_()
    });
    row = update_('Companies', row.id, patch);
  }
  dUp_(delta, 'Companies', row);
  return { delta: delta, id: row.id };
}

function deleteCompany_(p) {
  var delta = newDelta_();
  where_('Contacts', function (c) { return c.company_id === p.id; }).slice().forEach(function (c) { dRm_(delta, 'Contacts', c.id); });
  where_('Lines', function (l) { return l.company_id === p.id; }).slice().forEach(function (l) { dRm_(delta, 'Lines', l.id); });
  where_('Batches', function (b) { return b.company_id === p.id; }).slice().forEach(function (b) { dRm_(delta, 'Batches', b.id); });
  // delete bottom-up so row numbers stay valid
  ['Contacts', 'Lines', 'Batches'].forEach(function (name) {
    var ids = (delta.remove[name] || []).slice();
    ids.forEach(function (id) { remove_(name, id); });
  });
  remove_('Companies', p.id);
  dRm_(delta, 'Companies', p.id);
  return { delta: delta };
}

var CONTACT_FIELDS = ['name', 'first_name', 'role', 'email', 'linkedin_url', 'line_override', 'copy_override_id'];

function saveContacts_(p) {
  var delta = newDelta_();
  var warnings = [];
  var company = byId_('Companies', p.company_id);
  if (!company) throw new Error('Company not found');
  (p.contacts || []).forEach(function (c) {
    var patch = {};
    CONTACT_FIELDS.forEach(function (f) { if (c[f] !== undefined) patch[f] = String(c[f] === null ? '' : c[f]).trim(); });
    if (patch.email !== undefined) patch.email = patch.email.toLowerCase();
    if (patch.email) {
      var dup = where_('Contacts', function (o) { return o.id !== c.id && String(o.email).toLowerCase() === patch.email; })[0];
      if (dup) warnings.push({ email: patch.email, message: 'Already exists in the database.' });
    }
    if (patch.name !== undefined && c.first_name === undefined) patch.first_name = patch.name.split(/\s+/)[0] || '';

    var row;
    if (c.id && byId_('Contacts', c.id)) {
      row = update_('Contacts', c.id, patch);
      if (row.status === 'ready' || row.status === 'scheduled') {
        var re = {};
        if (patch.line_override !== undefined) re.assigned_line = assignLine_(row);
        if (patch.copy_override_id !== undefined) re.assigned_copy_id = assignCopyId_(row, company) || row.assigned_copy_id;
        if (Object.keys(re).length) row = update_('Contacts', row.id, re);
      }
    } else {
      if (!patch.name) return;
      row = insert_('Contacts', {
        id: c.id, company_id: p.company_id, name: patch.name, first_name: patch.first_name || '', role: patch.role || '',
        email: patch.email || '', linkedin_url: patch.linkedin_url || '', line_override: patch.line_override || '',
        copy_override_id: patch.copy_override_id || '', status: 'draft', assigned_line: '', assigned_copy_id: '',
        batch_id: '', thread_id: '', first_sent_at: '', last_sent_at: '', followups_sent: 0, replied_at: '', created_at: nowIso_()
      });
    }
    dUp_(delta, 'Contacts', row);
  });
  return { delta: delta, warnings: warnings };
}

function removeContact_(p) {
  var delta = newDelta_();
  var c = byId_('Contacts', p.id);
  if (!c) return { delta: delta };
  if (c.batch_id) {
    dropContactFromBatch_(c.batch_id, c.id, delta);
  }
  remove_('Contacts', c.id);
  dRm_(delta, 'Contacts', c.id);
  return { delta: delta };
}

function saveLines_(p) {
  var delta = newDelta_();
  var incoming = (p.lines || []).filter(function (l) { return String(l.text || '').trim(); }).slice(0, 5);
  var existing = where_('Lines', function (l) { return l.company_id === p.company_id; });
  var keep = {};
  incoming.forEach(function (l) {
    var row;
    if (l.id && byId_('Lines', l.id)) row = update_('Lines', l.id, { text: String(l.text).trim() });
    else row = insert_('Lines', { id: l.id, company_id: p.company_id, text: String(l.text).trim() });
    keep[row.id] = true;
    dUp_(delta, 'Lines', row);
  });
  existing.slice().forEach(function (l) {
    if (!keep[l.id]) { remove_('Lines', l.id); dRm_(delta, 'Lines', l.id); }
  });
  return { delta: delta };
}

function saveCopy_(p) {
  var c = p.copy || {};
  var body = c.body_html !== undefined ? c.body_html : '';
  var patch = {
    name: c.name, kind: c.kind === 'followup' ? 'followup' : 'first', tags: csvOf_(c.tags),
    subject: c.subject || '', body_html: body, image_url: c.image_url || '',
    include_signature: !!c.include_signature, updated_at: nowIso_()
  };
  patch.uses_vars = usedVars_(patch.subject).concat(usedVars_(body)).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(',');
  var row;
  if (c.id && byId_('Copies', c.id)) row = update_('Copies', c.id, patch);
  else {
    if (!patch.name) throw new Error('Copy name is required');
    patch.archived = false;
    row = insert_('Copies', patch);
  }
  var delta = newDelta_();
  dUp_(delta, 'Copies', row);
  return { delta: delta, id: row.id };
}

function archiveCopy_(p) {
  var delta = newDelta_();
  dUp_(delta, 'Copies', update_('Copies', p.id, { archived: p.archived !== false, updated_at: nowIso_() }));
  return { delta: delta };
}

function saveSettings_(p) {
  var s = p.settings || {};
  var allowed = Object.keys(DEFAULT_SETTINGS);
  Object.keys(s).forEach(function (k) {
    if (allowed.indexOf(k) >= 0) saveSetting_(k, s[k]);
  });
  return { settings: settings_() };
}

function addRole_(p) {
  var role = String(p.role || '').trim();
  if (!role) throw new Error('Role is required');
  var exists = getAll_('Roles').some(function (r) { return r.role.toLowerCase() === role.toLowerCase(); });
  if (!exists) insert_('Roles', { role: role });
  return { roles: getAll_('Roles').map(function (r) { return r.role; }) };
}

var ACTIONS = {
  bootstrap: { fn: bootstrap_ },
  getCompany: { fn: getCompany_ },
  saveCompany: { fn: saveCompany_, write: true },
  deleteCompany: { fn: deleteCompany_, write: true },
  saveContacts: { fn: saveContacts_, write: true },
  setReady: { fn: function (p) { return setReady_(p.ids || [], p.ready !== false); }, write: true },
  removeContact: { fn: removeContact_, write: true },
  saveLines: { fn: saveLines_, write: true },
  listCopies: { fn: function () { return { copies: rows_('Copies') }; } },
  saveCopy: { fn: saveCopy_, write: true },
  archiveCopy: { fn: archiveCopy_, write: true },
  previewEmail: { fn: previewEmail_ },
  sendTest: { fn: sendTest_ },
  listBatches: { fn: listBatches_ },
  rescheduleBatch: { fn: function (p) { return rescheduleBatch_(p.id, p.scheduled_at); }, write: true },
  cancelBatch: { fn: function (p) { return cancelBatch_(p.id); }, write: true },
  removeFromBatch: { fn: function (p) { return removeFromBatch_(p.batch_id, p.contact_id); }, write: true },
  planBatches: { fn: function (p) { return planBatches_(p.company_ids || [], p.start, p.time, p.spacing, !!p.dry_run); }, write: true },
  getCalendar: { fn: getCalendar_ },
  getSettings: { fn: function () { return { settings: settings_(), sheet_url: sheetUrl_() }; } },
  saveSettings: { fn: saveSettings_, write: true },
  addRole: { fn: addRole_, write: true }
};

// ---------- one-time setup (run from the Apps Script editor) ----------

function setup() {
  var ss = ss_();
  Object.keys(SCHEMA).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var cols = SCHEMA[name];
    if (sh.getMaxColumns() < cols.length) sh.insertColumnsAfter(sh.getMaxColumns(), cols.length - sh.getMaxColumns());
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  var blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) ss.deleteSheet(blank);

  CACHE_ = {};
  if (!getAll_('Roles').length) SEED_ROLES.forEach(function (r) { insert_('Roles', { role: r }); });
  var have = {};
  getAll_('Settings').forEach(function (r) { have[r.key] = true; });
  Object.keys(DEFAULT_SETTINGS).forEach(function (k) { if (!have[k]) saveSetting_(k, DEFAULT_SETTINGS[k]); });

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runTrigger') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runTrigger').timeBased().everyMinutes(10).create();
  console.log('Setup complete. Trigger installed (every 10 minutes). Test mode is ON.');
}

