// The only file that talks to Apps Script.
// Requests are text/plain so the browser sends no CORS preflight.

const TOKEN_KEY = 'outreach.token';
const URL_KEY = 'outreach.apiUrl';

const safe = {
  get: (k: string) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

export const getToken = () => safe.get(TOKEN_KEY);
export const setToken = (t: string) => safe.set(TOKEN_KEY, t.trim());
export const getApiUrl = () => (import.meta.env.VITE_API_URL as string | undefined) || safe.get(URL_KEY);
export const setApiUrl = (u: string) => safe.set(URL_KEY, u.trim());
export const hasEnvUrl = () => !!import.meta.env.VITE_API_URL;
export const isConfigured = () => !!getApiUrl() && !!getToken();

export class ApiError extends Error {
  unauthorized: boolean;
  constructor(message: string, unauthorized = false) {
    super(message);
    this.unauthorized = unauthorized;
  }
}

export async function call<T = any>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const url = getApiUrl();
  const token = getToken();
  if (!url || !token) throw new ApiError('Add the API URL and token in Settings.', true);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ token, action, payload }),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    });
  } catch {
    throw new ApiError('Could not reach the server. Check your connection.');
  }
  let json: { ok: boolean; data?: T; error?: string };
  try {
    json = await res.json();
  } catch {
    throw new ApiError('The server sent an unexpected response.');
  }
  if (!json.ok) throw new ApiError(json.error || 'Request failed', json.error === 'Unauthorized');
  return json.data as T;
}
