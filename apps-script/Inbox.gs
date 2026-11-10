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
