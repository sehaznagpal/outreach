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
