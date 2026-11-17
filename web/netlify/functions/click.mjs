import { FALLBACK_URL, record } from '../lib/record.mjs';

export default async (req, context) => {
  const send_id = String(context.params?.send || '');
  const link_key = String(context.params?.key || '');
  let url = '';
  if (/^[a-z0-9]{6,12}$/.test(send_id) && /^[\w-]+$/.test(link_key)) {
    const data = await record({ send_id, type: 'click', link_key, user_agent: req.headers.get('user-agent') || '' });
    url = data?.url || '';
  }
  if (!/^https?:\/\//i.test(url)) url = FALLBACK_URL;
  return new Response(null, { status: 302, headers: { Location: url, 'Cache-Control': 'no-store' } });
};

export const config = { path: '/r/:send/:key' };
