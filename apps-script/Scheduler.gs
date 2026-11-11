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
    if (company.status === 'replied') { errors.push({ contact_id: c.id, message: 'This company replied. Outreach is stopped.' }); return; }
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
  dUp_(delta, 'Batches', update_('Batches', b.id, { status: 'cancelled', reason: 'Cancelled by you' }));
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
