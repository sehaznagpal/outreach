import { record } from '../lib/record.mjs';

const GIF = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), (c) => c.charCodeAt(0));

export default async (req, context) => {
  const id = String(context.params?.file || '').replace(/\.gif$/i, '');
  if (/^[a-z0-9]{6,12}$/.test(id)) {
    await record({ send_id: id, type: 'open', user_agent: req.headers.get('user-agent') || '' });
  }
  return new Response(GIF, {
    status: 200,
    headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0', Pragma: 'no-cache', Expires: '0' },
  });
};

export const config = { path: '/o/:file' };
