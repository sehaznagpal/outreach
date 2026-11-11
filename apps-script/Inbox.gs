/**
 * Inbox.gs — reply + bounce detection. One reply from anyone at a company stops the whole company.
 * Reply detection always runs before sending, inside the same lock as sending and UI writes.
 */

var PUBLIC_DOMAINS = ['gmail.com', 'outlook.com', 'yahoo.com', 'hotmail.com', 'icloud.com', 'proton.me'];

function cleanDomain_(d) {
  return String(d || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[\/?#].*$/, '');
}

function fromEmail_(m) {
  var from = String(m.getFrom() || '');
  var hit = /<([^>]+)>/.exec(from);
  return (hit ? hit[1] : from).trim().toLowerCase();
}

function isOtherSender_(m, me) {
  var from = String(m.getFrom() || '').toLowerCase();
  return from.indexOf(me) < 0 && !/mailer-daemon|postmaster/.test(from);
}

/** Automatic replies do not count: Auto-Submitted header (other than "no") or an auto-looking subject. */
function isAutomatic_(m) {
  var subject = String(m.getSubject() || '').trim().toLowerCase();
  if (/^(automatic reply|auto:|out of office|ooo)/.test(subject)) return true;
  var head = String(m.getRawContent() || '').split(/\r?\n\r?\n/)[0];
  var hit = /^Auto-Submitted:\s*(.+)$/im.exec(head);
  return !!(hit && hit[1].trim().toLowerCase() !== 'no');
}

/** Stops all outreach to a company. Caller must hold the script lock. Returns a delta. */
function companyReplied_(company, contact, who, atIso) {
  var delta = newDelta_();
  atIso = atIso || nowIso_();

  if (contact) dUp_(delta, 'Contacts', update_('Contacts', contact.id, { status: 'replied', replied_at: atIso, batch_id: '' }));
  dUp_(delta, 'Companies', update_('Companies', company.id, { status: 'replied', replied_at: atIso, replied_by: contact ? contact.name : who }));

  where_('Batches', function (b) { return b.company_id === company.id && b.status === 'planned'; }).slice().forEach(function (b) {
    var sentIds = where_('SendLog', function (r) { return r.batch_id === b.id && r.result === 'ok'; }).map(function (r) { return r.contact_id; });
    var sent = [], skipped = [];
    csv_(b.contact_ids).forEach(function (id) {
      var c = byId_('Contacts', id);
      (sentIds.indexOf(id) >= 0 ? sent : skipped).push(c ? c.name : id);
    });
    var partial = sent.length > 0;
    var reason = 'Company replied' + (partial ? '. Sent: ' + sent.join(', ') + '. Skipped: ' + (skipped.join(', ') || 'none') + '.' : '');
    dUp_(delta, 'Batches', update_('Batches', b.id, { status: partial ? 'partial' : 'cancelled', reason: reason, sent_at: partial ? atIso : '' }));
  });

  where_('Contacts', function (c) { return c.company_id === company.id; }).forEach(function (c) {
    if (contact && c.id === contact.id) return;
    if (['draft', 'ready', 'scheduled', 'sent', 'followed_up'].indexOf(c.status) < 0) return;
    dUp_(delta, 'Contacts', update_('Contacts', c.id, { status: 'stopped', batch_id: '' }));
  });
  return delta;
}

function resumeCompany_(companyId) {
  var delta = newDelta_();
  var company = byId_('Companies', companyId);
  if (!company) throw new Error('Company not found');
  dUp_(delta, 'Companies', update_('Companies', company.id, { status: 'active' }));
  where_('Contacts', function (c) { return c.company_id === companyId && c.status === 'stopped'; }).forEach(function (c) {
    dUp_(delta, 'Contacts', update_('Contacts', c.id, { status: 'draft', batch_id: '' }));
  });
  return { delta: delta };
}

function markCompanyReplied_(companyId, contactId, who) {
  var company = byId_('Companies', companyId);
  if (!company) throw new Error('Company not found');
  var contact = contactId ? byId_('Contacts', contactId) : null;
  return { delta: companyReplied_(company, contact, who || 'Someone', nowIso_()) };
}

/** Looks for a reply at every company that has not replied yet. Runs before every send. */
function detectReplies_() {
  var me = Session.getEffectiveUser().getEmail().toLowerCase();
  var cutoff = isoFromDate_(new Date(Date.now() - 30 * 86400000));

  where_('Companies', function (c) { return c.status !== 'replied' && c.status !== 'done'; }).slice().forEach(function (company) {
    try {
      var people = where_('Contacts', function (c) { return c.company_id === company.id; });
      var sentAt = people.filter(function (c) { return c.first_sent_at; }).map(function (c) { return c.first_sent_at; }).sort();
      if (!sentAt.length) return;
      var hit = null;

      // 1. any message from someone else in this company's outreach threads
      people.filter(function (c) {
        return (c.status === 'sent' || c.status === 'followed_up') && c.thread_id && c.first_sent_at >= cutoff;
      }).forEach(function (c) {
        if (hit) return;
        var thread = GmailApp.getThreadById(c.thread_id);
        if (!thread) return;
        thread.getMessages().forEach(function (m) {
          if (hit || !isOtherSender_(m, me) || isAutomatic_(m)) return;
          hit = { contact: c, who: fromEmail_(m), at: m.getDate() };
        });
      });

      // 2. any email from the company's domain after my first email (new threads, forwards)
      var domain = cleanDomain_(company.domain);
      if (!hit && domain && PUBLIC_DOMAINS.indexOf(domain) < 0) {
        var first = new Date(sentAt[0]).getTime();
        GmailApp.search('from:@' + domain + ' after:' + Math.floor(first / 1000), 0, 20).forEach(function (t) {
          t.getMessages().forEach(function (m) {
            if (hit || m.getDate().getTime() < first) return;
            if (String(m.getFrom()).toLowerCase().indexOf('@' + domain) < 0) return;
            if (!isOtherSender_(m, me) || isAutomatic_(m)) return;
            var email = fromEmail_(m);
            var known = people.filter(function (p) { return String(p.email).toLowerCase() === email; })[0] || null;
            hit = { contact: known, who: email, at: m.getDate() };
          });
        });
      }

      if (hit) companyReplied_(company, hit.contact, hit.who, isoFromDate_(hit.at));
    } catch (e) {
      console.error('reply check for ' + company.name + ': ' + e);
    }
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
