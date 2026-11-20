/**
 * Sender.gs — the 10-minute trigger: send due batches, then check the inbox.
 */

function runTrigger() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return;
  try {
    var S = settings_();
    if (S.paused) return;
    detectReplies_();   // always before sending
    CACHE_ = {};
    sendDue_(S);
    checkBounces_();
  } finally {
    lock.releaseLock();
  }
}

function logSend_(c, batch, type, copyId, line, subject, threadId, result, error, id, to) {
  insert_('SendLog', {
    id: id || '',
    contact_id: c.id, company_id: c.company_id, batch_id: batch.id, type: type, copy_id: copyId || '',
    line_used: line || '', subject: subject || '', sent_at: nowIso_(), thread_id: threadId || '',
    result: result, error: error || '', to: to || ''
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

function myEmail_() {
  var e = '';
  try { e = Session.getEffectiveUser().getEmail(); } catch (x) { /* ignore */ }
  if (!e) { try { e = Session.getActiveUser().getEmail(); } catch (y) { /* ignore */ } }
  return String(e || '').toLowerCase();
}

function mimeWord_(s) {
  return '=?UTF-8?B?' + Utilities.base64Encode(String(s), Utilities.Charset.UTF_8) + '?=';
}

function mimeBody_(s) {
  return (Utilities.base64Encode(String(s), Utilities.Charset.UTF_8).match(/.{1,76}/g) || ['']).join('\r\n');
}

/** A multipart/alternative MIME message with an explicit To, in-thread headers and a sender name. */
function buildMime_(from, name, to, subject, plain, html, messageId) {
  var boundary = 'b' + Utilities.getUuid().replace(/-/g, '');
  var h = [
    'From: ' + (name ? mimeWord_(name) + ' <' + from + '>' : from),
    'To: ' + to,
    'Subject: ' + mimeWord_(subject),
    'MIME-Version: 1.0'
  ];
  if (messageId) { h.push('In-Reply-To: ' + messageId); h.push('References: ' + messageId); }
  h.push('Content-Type: multipart/alternative; boundary="' + boundary + '"');
  return h.join('\r\n') + '\r\n\r\n' +
    '--' + boundary + '\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' + mimeBody_(plain) + '\r\n' +
    '--' + boundary + '\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' + mimeBody_(html) + '\r\n' +
    '--' + boundary + '--';
}

/**
 * The one place every email leaves from. o: { to, subject, plain, html, followup, threadId }.
 * Follow-ups go through the Gmail API with an explicit To, never GmailThread.reply().
 * Returns the subject actually used.
 */
function deliver_(S, o) {
  var to = String(o.to || '').trim();
  if (!to) throw new Error('No recipient address');
  if (!S.test_mode && to.toLowerCase() === myEmail_()) throw new Error('Blocked: recipient is your own address (' + to + ')');
  if (!o.followup || S.test_mode) {
    GmailApp.sendEmail(to, o.subject, o.plain, { htmlBody: o.html, name: S.sender_name });
    return o.subject;
  }
  var thread = GmailApp.getThreadById(o.threadId);
  if (!thread) throw new Error('Thread not found');
  var first = thread.getMessages()[0];
  var subject = thread.getFirstMessageSubject();
  if (!/^\s*re:/i.test(subject)) subject = 'Re: ' + subject;
  var raw = Utilities.base64EncodeWebSafe(buildMime_(myEmail_(), S.sender_name, to, subject, o.plain, o.html, first.getHeader('Message-ID')), Utilities.Charset.UTF_8);
  Gmail.Users.Messages.send({ raw: raw, threadId: o.threadId }, 'me');
  return subject;
}

/** Sends one email. Returns true on success (or a test send), false on error (already logged). */
function sendOne_(batch, c, company, S) {
  var isFollowup = batch.type === 'followup';
  var type = isFollowup ? 'followup_' + ((c.followups_sent || 0) + 1) : 'first';
  var copy = copyFor_(c, company, isFollowup ? 'followup' : 'first');
  var to = S.test_mode ? S.test_email : c.email;
  try {
    if (!copy) throw new Error(isFollowup ? 'No follow-up copy available' : 'No copy available');
    if (isFollowup && !c.thread_id && !S.test_mode) throw new Error('No thread to reply to');
    var banner = S.test_mode ? 'Test mode. This would have gone to ' + c.name + ' <' + c.email + '>.' : '';
    var sendId = uid_();
    var r = renderEmail_(c, company, copy, S, { banner: banner, sendId: sendId });
    if (r.missing.length) throw new Error('Missing variable: ' + r.missing.join(', '));

    if (S.test_mode) {
      if (!S.test_email) throw new Error('Test mode is on but test_email is not set');
      deliver_(S, { to: to, subject: (isFollowup ? '[Follow-up] ' : '') + r.subject, plain: r.plain, html: r.html });
      logSend_(c, batch, type, copy.id, c.assigned_line, r.subject, '', 'test', '', sendId, to);
      return true;
    }

    var threadId = c.thread_id;
    var subject = deliver_(S, { to: to, subject: r.subject, plain: r.plain, html: r.html, followup: isFollowup, threadId: c.thread_id });
    if (!isFollowup) threadId = findThreadId_(c.email, r.subject);
    var now = nowIso_();
    if (isFollowup) {
      c = update_('Contacts', c.id, { status: 'followed_up', followups_sent: (c.followups_sent || 0) + 1, last_sent_at: now });
    } else {
      c = update_('Contacts', c.id, { status: 'sent', first_sent_at: now, last_sent_at: now, thread_id: threadId, assigned_copy_id: copy.id });
    }
    logSend_(c, batch, type, copy.id, c.assigned_line, subject, threadId, 'ok', '', sendId, to);
    scheduleFollowup_(c, company, S, now);
    return true;
  } catch (err) {
    logSend_(c, batch, type, copy ? copy.id : '', c.assigned_line, '', '', 'error', String(err.message || err), '', to);
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
    var company = fresh_('Companies', batch.company_id);
    if (!company) { update_('Batches', batch.id, { status: 'cancelled', reason: 'Company removed' }); return; }
    if (company.status === 'paused' || company.status === 'done' || company.status === 'replied') return;
    var sent = 0, errors = 0, remaining = 0;
    var sentNames = [], skippedNames = [], stopped = false;

    csv_(batch.contact_ids).forEach(function (id) {
      // re-read from the Sheet right before each email
      company = fresh_('Companies', batch.company_id);
      var c = fresh_('Contacts', id);
      if (company && company.status === 'replied') {
        stopped = true;
        if (c) skippedNames.push(c.name);
        return;
      }
      var eligible = c && c.batch_id === batch.id && !c.replied_at &&
        (batch.type === 'first' ? c.status === 'scheduled' : (c.status === 'sent' || c.status === 'followed_up'));
      if (!eligible) return;

      if (S.test_mode) {
        if (!alreadyTested_(batch.id, c.id)) sendOne_(batch, c, company, S);
        return;
      }
      if (okToday >= S.daily_cap) { capHit = true; remaining++; return; }
      if (batch.type === 'first' && alreadyContacted_(c)) {
        logSend_(c, batch, 'first', '', '', '', '', 'error', 'Email already contacted', '', c.email);
        update_('Contacts', c.id, { status: 'stopped', batch_id: '' });
        errors++;
        return;
      }
      if (sendOne_(batch, c, company, S)) { sent++; okToday++; sentNames.push(c.name); }
      else {
        errors++;
        // send the contact back to Ready so it can be re-planned once fixed
        if (batch.type === 'first') update_('Contacts', c.id, { status: 'ready', batch_id: '' });
      }
    });

    if (stopped) {
      update_('Batches', batch.id, {
        status: sent > 0 ? 'partial' : 'cancelled', sent_at: sent > 0 ? now : '',
        reason: 'Company replied. Sent: ' + (sentNames.join(', ') || 'none') + '. Skipped: ' + (skippedNames.join(', ') || 'none') + '.'
      });
      return;
    }
    if (S.test_mode || remaining > 0) return; // batch stays planned
    var status = sent === 0 && errors === 0 ? 'cancelled' : (errors > 0 ? 'partial' : 'sent');
    update_('Batches', batch.id, { status: status, sent_at: now });
  });

  if (capHit) saveSetting_('cap_hit_date', today);
}
