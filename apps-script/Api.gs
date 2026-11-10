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
