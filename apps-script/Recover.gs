/**
 * Recover.gs — one-off: re-queue today's follow-ups that went to the owner's own address (the GmailThread.reply() bug).
 * Run `recoverFollowups` once from the Apps Script editor. It also asks for the Gmail service permission.
 */

function recoverFollowups() {
  var profile = Gmail.Users.getProfile('me'); // triggers the authorisation prompt for the Gmail service
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  var summary;
  try { summary = recoverFollowups_(String(profile.emailAddress || '').toLowerCase()); }
  finally { lock.releaseLock(); }
  Logger.log(summary);
  return summary;
}

function recoverFollowups_(me) {
  CACHE_ = {};
  var today = dateOf_(nowIso_());
  var bad = where_('SendLog', function (r) {
    return r.result === 'ok' && /^followup/.test(r.type) && dateOf_(r.sent_at) === today && (!r.to || String(r.to).toLowerCase() === me);
  });
  var byContact = {};
  bad.forEach(function (r) { (byContact[r.contact_id] = byContact[r.contact_id] || []).push(r); });

  var skipped = 0, requeue = {}; // company id -> [contact ids]
  Object.keys(byContact).forEach(function (cid) {
    var rows = byContact[cid];
    var c = byId_('Contacts', cid);
    var company = c ? byId_('Companies', c.company_id) : null;
    if (!c || !company || String(c.email).toLowerCase() === me || !c.email) { skipped++; return; }
    if (c.replied_at || company.status === 'replied' || company.status === 'paused' || company.status === 'done' ||
        (c.status !== 'sent' && c.status !== 'followed_up')) { skipped++; return; }

    // earlier sends that did go out, to restore last_sent_at
    var badIds = {};
    rows.forEach(function (r) { badIds[r.id] = true; });
    var earlier = where_('SendLog', function (r) { return r.contact_id === cid && r.result === 'ok' && !badIds[r.id]; })
      .map(function (r) { return r.sent_at; }).sort();
    var n = Math.max(0, (c.followups_sent || 0) - rows.length);
    cancelFollowups_(c);
    update_('Contacts', cid, {
      followups_sent: n, status: n > 0 ? 'followed_up' : 'sent',
      last_sent_at: earlier.length ? earlier[earlier.length - 1] : c.first_sent_at
    });
    rows.forEach(function (r) {
      update_('SendLog', r.id, { result: 'error', error: 'Delivered to your own address by mistake. Re-queued.', to: r.to || me });
    });
    (requeue[company.id] = requeue[company.id] || []).push(cid);
  });

  var now = nowIso_(), count = 0;
  Object.keys(requeue).forEach(function (companyId) {
    var ids = requeue[companyId];
    var batch = insert_('Batches', { company_id: companyId, type: 'followup', scheduled_at: now, status: 'planned', contact_ids: ids.join(','), sent_at: '', created_at: now });
    ids.forEach(function (id) { update_('Contacts', id, { batch_id: batch.id }); });
    count += ids.length;
  });
  return 'Re-queued ' + count + ' follow-up(s) in ' + Object.keys(requeue).length + ' batch(es), due on the next 10-minute run. Skipped ' + skipped + ' (replied, paused, or not found).';
}
