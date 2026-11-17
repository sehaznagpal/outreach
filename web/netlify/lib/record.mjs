// Shared by the open and click functions: posts one event to Apps Script.
const DEFAULT_API = 'https://script.google.com/macros/s/AKfycbxbIiGaNQvnMholvDp4qzZqatkrKjAAO6wPwuS5DD3YpL4O24-ud1QCezzGCug84Y5c/exec';
export const FALLBACK_URL = process.env.OUTREACH_FALLBACK_URL || 'https://sehaznagpal.vercel.app';

export async function record(payload) {
  const token = process.env.OUTREACH_API_TOKEN;
  if (!token) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(process.env.OUTREACH_API_URL || DEFAULT_API, {
      method: 'POST',
      body: JSON.stringify({ token, action: 'recordEvent', payload }),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      signal: ctl.signal,
    });
    const json = await res.json();
    return json.ok ? json.data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
