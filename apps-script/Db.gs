/**
 * Db.gs — Sheet read/write helpers. The Sheet is the database.
 * Every cell is stored as text (number format "@") so ISO timestamps are never
 * converted into Date cells. Types are restored on read using BOOLS / NUMS.
 */

var TZ = 'Asia/Kolkata';

var SCHEMA = {
  Companies: ['id', 'name', 'industry', 'domain', 'website', 'opening_title', 'opening_url', 'pitch_page_url', 'email_pattern', 'notes', 'copy_ids', 'followup_copy_ids', 'batch_size', 'followup_after_days', 'max_followups', 'status', 'created_at', 'replied_at', 'replied_by'],
  Contacts: ['id', 'company_id', 'name', 'first_name', 'role', 'email', 'linkedin_url', 'line_override', 'copy_override_id', 'status', 'assigned_line', 'assigned_copy_id', 'batch_id', 'thread_id', 'first_sent_at', 'last_sent_at', 'followups_sent', 'replied_at', 'created_at'],
  Lines: ['id', 'company_id', 'text'],
  Copies: ['id', 'name', 'kind', 'tags', 'subject', 'body_html', 'uses_vars', 'image_url', 'signature_id', 'auto_link', 'archived', 'updated_at'],
  Batches: ['id', 'company_id', 'type', 'scheduled_at', 'status', 'contact_ids', 'sent_at', 'created_at', 'reason'],
  Links: ['id', 'label', 'url', 'key', 'auto_words', 'is_primary', 'scope', 'company_id', 'contact_id', 'created_at'],
  Signatures: ['id', 'name', 'html', 'image_url', 'is_default', 'updated_at'],
  SendLog: ['id', 'contact_id', 'company_id', 'batch_id', 'type', 'copy_id', 'line_used', 'subject', 'sent_at', 'thread_id', 'result', 'error'],
  Roles: ['role'],
  Settings: ['key', 'value']
};

var BOOLS = { auto_link: 1, archived: 1, is_primary: 1, is_default: 1 };
var NUMS = { batch_size: 1, followup_after_days: 1, max_followups: 1, followups_sent: 1 };

var SEED_ROLES = ['Founder', 'Co-founder', 'CEO', 'CTO', 'CPO', 'Chief of Staff', "Founder's Office", 'Head of Product', 'Product Manager', 'Associate Product Manager', 'Head of Design', 'Design Lead', 'Design Manager', 'Product Designer', 'UX Researcher', 'Engineering Manager', 'Hiring Manager', 'HR', 'HR Business Partner', 'Talent Acquisition', 'Recruiter', 'Other'];

var DEFAULT_SETTINGS = {
  daily_cap: '15',
  send_days: 'Mon,Tue,Wed,Thu,Fri',
  default_send_time: '10:30',
  followup_after_days: '4',
  max_followups: '1',
  sender_name: 'Sehaz',
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
    sender_name: r.sender_name || '',
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


// ---------- re-read straight from the Sheet ----------

function fresh_(name, id) {
  delete CACHE_[name];
  return byId_(name, id);
}

// ---------- schema + content migration ----------

var SCHEMA_VERSION = '2';

function transformCopy_(o) {
  if (o.include_signature !== undefined) {
    o.signature_id = String(o.include_signature).toLowerCase() === 'false' ? 'none' : '';
  }
  if (o.auto_link === undefined || o.auto_link === '') o.auto_link = 'true';
}

/** Creates missing tabs and rewrites any tab whose header differs from SCHEMA, keeping data. */
function migrateSchema_() {
  var ss = ss_();
  Object.keys(SCHEMA).forEach(function (name) {
    var cols = SCHEMA[name];
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
    var oldHeader = lastRow >= 1 && lastCol >= 1 ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
    var same = oldHeader.length === cols.length && cols.every(function (c, i) { return oldHeader[i] === c; });
    var out = [];
    if (!same) {
      var oldRows = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
      oldRows.forEach(function (r) {
        var o = {}, any = false;
        oldHeader.forEach(function (h, i) { if (h) { o[h] = r[i]; if (r[i] !== '') any = true; } });
        if (!any) return;
        if (name === 'Copies') transformCopy_(o);
        out.push(cols.map(function (c) { return toStr_(o[c]); }));
      });
      sh.clearContents();
    }
    if (sh.getMaxColumns() < cols.length) sh.insertColumnsAfter(sh.getMaxColumns(), cols.length - sh.getMaxColumns());
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
    if (out.length) sh.getRange(2, 1, out.length, cols.length).setValues(out);
  });
  CACHE_ = {};
}

/** Seeds the three links and moves the old Settings signature / portfolio into Content. */
function migrateContent_() {
  CACHE_ = {};
  var sig = '', port = '';
  getAll_('Settings').forEach(function (r) {
    if (r.key === 'signature_html') sig = String(r.value || '');
    if (r.key === 'portfolio_url') port = String(r.value || '');
  });
  if (!getAll_('Links').length) {
    var base = { scope: 'global', company_id: '', contact_id: '', created_at: nowIso_() };
    [
      { label: 'Portfolio', url: port.trim() || 'https://sehaznagpal.vercel.app', key: 'portfolio', auto_words: 'portfolio, my work', is_primary: true },
      { label: 'CV', url: '', key: 'cv', auto_words: '', is_primary: false },
      { label: 'LinkedIn', url: '', key: 'linkedin', auto_words: '', is_primary: false }
    ].forEach(function (l) { for (var k in base) l[k] = base[k]; insert_('Links', l); });
  } else if (port.trim()) {
    var pl = where_('Links', function (l) { return l.scope === 'global' && l.key === 'portfolio'; })[0];
    if (pl && !pl.url) update_('Links', pl.id, { url: port.trim() });
  }
  if (sig.trim()) {
    var hasDefault = getAll_('Signatures').some(function (x) { return x.is_default; });
    insert_('Signatures', { name: 'Default', html: sig, image_url: '', is_default: !hasDefault, updated_at: nowIso_() });
  }
  getAll_('Settings').forEach(function (r) {
    if ((r.key === 'signature_html' || r.key === 'portfolio_url') && r.value !== '') {
      sheet_('Settings').getRange(r._row, 2).setValue('');
      r.value = '';
    }
  });
}

function ensureMigrated_() {
  var props = PropertiesService.getScriptProperties();
  var upToDate = props.getProperty('SCHEMA_VERSION') === SCHEMA_VERSION;
  if (upToDate) {
    var pending = getAll_('Settings').some(function (r) {
      return (r.key === 'signature_html' || r.key === 'portfolio_url') && String(r.value).trim() !== '';
    });
    if (!pending) return;
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    CACHE_ = {};
    if (props.getProperty('SCHEMA_VERSION') !== SCHEMA_VERSION) {
      migrateSchema_();
      props.setProperty('SCHEMA_VERSION', SCHEMA_VERSION);
    }
    migrateContent_();
  } finally {
    lock.releaseLock();
  }
  CACHE_ = {};
}
