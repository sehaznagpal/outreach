/**
 * Tracking.gs — open and click events posted by the Netlify functions (/o/:id.gif, /r/:id/:key).
 * Opens are approximate: anything within 2 minutes of sending, or from a known scanner, is marked likely_auto.
 */

var AUTO_UA_ = /bot|crawl|spider|scan|prefetch|preview|barracuda|proofpoint|mimecast|symantec|trend\s?micro|mcafee|safelinks|forcepoint|headless|python|curl|wget|go-http|node-fetch|java\/|slack|facebookexternalhit|twitter|whatsapp|skype/i;

function fallbackUrl_() {
  var l = where_('Links', function (x) { return x.scope === 'global' && x.is_primary && x.url; })[0];
  return l ? l.url : 'https://sehaznagpal.vercel.app';
}

/** payload: { send_id, type: 'open'|'click', link_key, user_agent }. Returns { url } for clicks. */
function recordEvent_(p) {
  var type = p.type === 'click' ? 'click' : 'open';
  var send = byId_('SendLog', String(p.send_id || ''));
  var url = '';
  if (type === 'click') {
    url = fallbackUrl_();
    if (send) {
      var key = String(p.link_key || '');
      var links = linkMap_(send.company_id, send.contact_id);
      if (links[key] && links[key].url) url = links[key].url;
    }
  }
  if (!send || send.result === 'error') return { url: url };
  var now = new Date();
  var ua = String(p.user_agent || '').slice(0, 300);
  var sentMs = new Date(send.sent_at).getTime();
  var auto = type === 'open' && (!ua || AUTO_UA_.test(ua) || (sentMs && now.getTime() - sentMs < 120000));
  var copyBatch = send.batch_id;
  insert_('Events', {
    send_id: send.id, contact_id: send.contact_id, company_id: send.company_id, batch_id: copyBatch,
    copy_id: send.copy_id, type: type, link_key: type === 'click' ? String(p.link_key || '') : '',
    at: isoFromDate_(now), user_agent: ua, likely_auto: auto
  });
  return { url: url };
}
