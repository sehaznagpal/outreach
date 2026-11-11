import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, call, isConfigured } from './api';
import type { Data, Delta, Table } from './types';

const KEYS: Record<Table, keyof Data> = {
  Companies: 'companies', Contacts: 'contacts', Lines: 'lines', Copies: 'copies', Batches: 'batches', SendLog: 'sendlog', Links: 'links', Signatures: 'signatures',
};

export const applyDelta = (d: Data, delta?: Delta): Data => {
  if (!delta) return d;
  const next: any = { ...d };
  (Object.keys(delta.upsert || {}) as Table[]).forEach((t) => {
    const key = KEYS[t];
    const list: any[] = [...next[key]];
    (delta.upsert![t] || []).forEach((row) => {
      const i = list.findIndex((r) => r.id === row.id);
      if (i >= 0) list[i] = row; else list.push(row);
    });
    next[key] = list;
  });
  (Object.keys(delta.remove || {}) as Table[]).forEach((t) => {
    const key = KEYS[t];
    const gone = new Set(delta.remove![t] || []);
    next[key] = (next[key] as any[]).filter((r) => !gone.has(r.id));
  });
  return next;
};

const CACHE_KEY = 'outreach.cache.v1';
/** Older backends may not send newer tables yet; never let a missing one crash a page. */
const norm = (d: Data): Data => ({ ...d, links: d.links || [], signatures: d.signatures || [], copies: d.copies || [] });
const readCache = (): Data | null => {
  try { const s = localStorage.getItem(CACHE_KEY); return s ? norm(JSON.parse(s)) : null; } catch { return null; }
};
const writeCache = (d: Data) => { try { localStorage.setItem(CACHE_KEY, JSON.stringify(d)); } catch { /* ignore */ } };

export interface Toast { id: number; kind: 'ok' | 'error'; text: string }
type Status = 'loading' | 'ready' | 'error' | 'unconfigured';

interface Store {
  data: Data | null;
  status: Status;
  error: string;
  saving: boolean;
  savedAt: number | null;
  toasts: Toast[];
  reload: (quiet?: boolean) => Promise<void>;
  /** Apply an optimistic change locally, call the server, then reconcile with the delta it returns. */
  mutate: <T = any>(action: string, payload: Record<string, unknown>, optimistic?: (d: Data) => Data) => Promise<T | undefined>;
  patch: (fn: (d: Data) => Data) => void;
  toast: (kind: Toast['kind'], text: string) => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  // show the last-known data instantly, then refresh in the background
  const [initial] = useState<Data | null>(() => (isConfigured() ? readCache() : null));
  const [data, setData] = useState<Data | null>(initial);
  const [status, setStatus] = useState<Status>(!isConfigured() ? 'unconfigured' : initial ? 'ready' : 'loading');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(0);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const toast = useCallback((kind: Toast['kind'], text: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);

  const reload = useCallback(async (quiet = false) => {
    if (!isConfigured()) { setStatus('unconfigured'); return; }
    if (!quiet) setStatus('loading');
    try {
      const d = norm(await call<Data>('bootstrap'));
      setData(d);
      setStatus('ready');
      setError('');
    } catch (e) {
      const err = e as ApiError;
      if (quiet) { toast('error', err.message); return; }
      setError(err.message);
      if (err.unauthorized) { try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ } }
      setStatus(err.unauthorized ? 'unconfigured' : 'error');
    }
  }, [toast]);

  useEffect(() => { void reload(!!initial); }, [reload]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!data) return;
    const t = setTimeout(() => writeCache(data), 1000);
    return () => clearTimeout(t);
  }, [data]);

  const patch = useCallback((fn: (d: Data) => Data) => setData((d) => (d ? fn(d) : d)), []);

  const mutate: Store['mutate'] = useCallback(async (action, payload, optimistic) => {
    if (optimistic) setData((d) => (d ? optimistic(d) : d));
    setPending((n) => n + 1);
    try {
      const res = await call<any>(action, payload);
      setData((d) => {
        if (!d) return d;
        let next = applyDelta(d, res?.delta);
        if (res?.settings) next = { ...next, settings: res.settings };
        if (res?.roles) next = { ...next, roles: res.roles };
        return next;
      });
      setSavedAt(Date.now());
      return res;
    } catch (e) {
      toast('error', (e as Error).message);
      if (optimistic) void reload(true);
      return undefined;
    } finally {
      setPending((n) => n - 1);
    }
  }, [reload, toast]);

  const value = useMemo<Store>(() => ({
    data, status, error, saving: pending > 0, savedAt, toasts, reload, mutate, patch, toast,
  }), [data, status, error, pending, savedAt, toasts, reload, mutate, patch, toast]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider missing');
  return s;
}

/** For pages that only render once data is loaded. */
export function useData(): Data {
  const { data } = useStore();
  if (!data) throw new Error('Data not loaded');
  return data;
}

export const uid = () => Math.random().toString(36).slice(2, 12).padEnd(10, '0');
