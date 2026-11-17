import { useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { fmtDay, dateOf, timeOf } from '../lib/dates';
import { call, getApiUrl, getToken, hasEnvUrl, setApiUrl, setToken } from '../api';
import { iconProps, SavedHint, Switch } from '../components/ui';
import { useStore } from '../store';
import type { ImportLog, Settings } from '../types';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function SettingsPage() {
  const { data, mutate, reload, toast, status, savedAt } = useStore();
  const [token, setTok] = useState(getToken());
  const [url, setUrl] = useState(getApiUrl());
  const [testing, setTesting] = useState(false);
  const pending = useRef<Partial<Settings>>({});
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const [dirty, setDirty] = useState(false);
  const [importing, setImporting] = useState(false);

  const s = data?.settings;
  const [draft, setDraft] = useState<Settings | null>(s || null);
  if (s && !draft) setDraft(s);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setDraft((d) => (d ? { ...d, [k]: v } : d));
    pending.current[k] = v;
    setDirty(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const patch = pending.current;
      pending.current = {};
      await mutate('saveSettings', { settings: patch }, (d) => ({ ...d, settings: { ...d.settings, ...patch } }));
      setDirty(false);
    }, 700);
  };

  // the tracking pixel and links need this site's address; fill it in once from where the app is open
  const filled = useRef(false);
  useEffect(() => {
    if (!draft || filled.current) return;
    filled.current = true;
    if (!draft.site_url && /^https:\/\//.test(window.location.origin)) set('site_url', window.location.origin);
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = async () => {
    setToken(token);
    if (!hasEnvUrl()) setApiUrl(url);
    setTesting(true);
    try {
      await call('getSettings');
      toast('ok', 'Connected.');
      await reload();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const importNow = async () => {
    setImporting(true);
    try {
      const res = await call<{ log: ImportLog }>('importNow');
      toast(res.log.errors && !res.log.imported ? 'error' : 'ok', res.log.errors && !res.log.imported ? res.log.errors : `Imported ${res.log.imported} ${res.log.imported === 1 ? 'company' : 'companies'}.`);
      await reload(true);
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setImporting(false);
    }
  };
  const runs = [...(data?.importlog || [])].sort((a, b) => (a.run_at < b.run_at ? 1 : -1)).slice(0, 5);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">Sending rules and connection.</p>
        </div>
        <SavedHint show={!dirty && !!savedAt} />
      </div>

      {status === 'unconfigured' && (
        <div className="banner attn">Paste your API URL and token below to connect. They stay in this browser only.</div>
      )}

      <div className="settings-grid">
        <section className="card">
          <h2>Connection</h2>
          <div className="col">
            {!hasEnvUrl() && (
              <div className="field"><label htmlFor="api-url">API URL</label>
                <input id="api-url" className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" /></div>
            )}
            <div className="field"><label htmlFor="api-token">API token</label>
              <input id="api-token" className="input" type="password" autoComplete="off" value={token} onChange={(e) => setTok(e.target.value)} placeholder="The API_TOKEN from Script Properties" />
              <span className="help">Stored in this browser only. Sent with every request.</span></div>
            <div className="row">
              <button className="btn primary" onClick={connect} disabled={testing || !token}>{testing ? 'Connecting' : 'Save and connect'}</button>
              {data?.meta.sheet_url && <a className="btn ghost" href={data.meta.sheet_url} target="_blank" rel="noreferrer">Open the Google Sheet <ExternalLink {...iconProps} /></a>}
            </div>
          </div>
          <details style={{ marginTop: 22 }}>
            <summary className="small muted" style={{ cursor: 'pointer' }}>Run setup</summary>
            <ol className="small muted" style={{ paddingLeft: 18, lineHeight: 1.8 }}>
              <li>Open the script in the Apps Script editor (<code>clasp open</code>).</li>
              <li>Pick <code>setup</code> in the function menu and press Run. It creates the Sheet tabs and installs the 10-minute trigger.</li>
              <li>Test mode is on by default. Turn it off below when you are ready to send for real.</li>
            </ol>
          </details>
        </section>

        {draft ? (
          <>
            <section className="card">
              <h2>Sending</h2>
              <div className="setting-row"><div><div>Pause all sending</div><div className="help">Nothing goes out while this is on.</div></div>
                <Switch label="Pause all sending" checked={draft.paused} onChange={(v) => set('paused', v)} /></div>
              <div className="setting-row"><div><div>Test mode</div><div className="help">Sends everything to the test address instead.</div></div>
                <Switch label="Test mode" checked={draft.test_mode} onChange={(v) => set('test_mode', v)} /></div>
              <div className="field" style={{ marginTop: 6 }}><label htmlFor="test-email">Test email</label>
                <input id="test-email" className="input" type="email" value={draft.test_email} onChange={(e) => set('test_email', e.target.value)} placeholder="you@example.com" /></div>
              <div className="setting-row" style={{ marginTop: 14 }}><div><div>Tracking</div><div className="help">Adds an open pixel and routes links through this site. Opens are approximate.</div></div>
                <Switch label="Tracking" checked={draft.tracking} onChange={(v) => set('tracking', v)} /></div>
              {draft.tracking && <div className="field" style={{ marginTop: 6 }}><label htmlFor="site-url">Site address</label>
                <input id="site-url" className="input" value={draft.site_url || ''} onChange={(e) => set('site_url', e.target.value.trim())} placeholder="https://your-site.netlify.app" /></div>}
            </section>

            <section className="card">
              <h2>Schedule</h2>
              <div className="col">
                <div className="field-row">
                  <div className="field"><label htmlFor="cap">Daily cap</label>
                    <input id="cap" className="input tnum" type="number" min={1} max={100} value={draft.daily_cap} onChange={(e) => set('daily_cap', Number(e.target.value))} /></div>
                  <div className="field"><label htmlFor="time">Default send time</label>
                    <input id="time" className="input" type="time" value={draft.default_send_time} onChange={(e) => set('default_send_time', e.target.value)} style={{ colorScheme: 'dark' }} /></div>
                </div>
                <div className="field"><label>Send days</label>
                  <div className="daypick">
                    {DAYS.map((d) => {
                      const on = draft.send_days.includes(d);
                      return <button key={d} type="button" className={`pill ${on ? 'selected' : ''}`} aria-pressed={on}
                        onClick={() => set('send_days', on ? draft.send_days.filter((x) => x !== d) : DAYS.filter((x) => x === d || draft.send_days.includes(x)))}>{d}</button>;
                    })}
                  </div>
                  <span className="help">Emails go out around the chosen time, within about ten minutes.</span>
                </div>
                <div className="field-row">
                  <div className="field"><label htmlFor="fu-days">Follow up after (days)</label>
                    <input id="fu-days" className="input tnum" type="number" min={1} value={draft.followup_after_days} onChange={(e) => set('followup_after_days', Number(e.target.value))} /></div>
                  <div className="field"><label htmlFor="fu-max">Max follow-ups</label>
                    <input id="fu-max" className="input tnum" type="number" min={0} max={5} value={draft.max_followups} onChange={(e) => set('max_followups', Number(e.target.value))} /></div>
                </div>
              </div>
            </section>

            <section className="card">
              <h2>You</h2>
              <div className="col">
                <div className="field"><label htmlFor="sender">Sender name</label>
                  <input id="sender" className="input" value={draft.sender_name} onChange={(e) => set('sender_name', e.target.value)} /></div>
                <div className="field"><label htmlFor="goal">Weekly goal (companies added)</label>
                  <input id="goal" className="input tnum" type="number" min={1} value={draft.weekly_goal_companies} onChange={(e) => set('weekly_goal_companies', Number(e.target.value))} /></div>
              </div>
            </section>

            <section className="card" style={{ gridColumn: '1 / -1' }}>
              <h2>Import from Scout</h2>
              <div className="field" style={{ maxWidth: 320 }}><label htmlFor="imp-day">Companies per day</label>
                <input id="imp-day" className="input tnum" type="number" min={0} max={50} value={draft.import_per_day ?? 4} onChange={(e) => set('import_per_day', Number(e.target.value))} /></div>
              <div className="row" style={{ marginTop: 16 }}>
                <button className="btn primary" onClick={importNow} disabled={importing}>{importing ? 'Importing. This can take a minute' : 'Import now'}</button>
                <span className="help">Also runs by itself every morning around 8am. Creates a company page with a few starter lines for approved Scout companies you have not applied to, oldest first. You add the people.</span>
              </div>
              {runs.length > 0 && (
                <div style={{ marginTop: 18 }}>
                  <div className="label" style={{ marginBottom: 6 }}>Recent runs</div>
                  {runs.map((r) => (
                    <div key={r.id} className="attn-item" style={{ display: 'block' }}>
                      <div className="small"><b style={{ fontWeight: 500 }}>{fmtDay(dateOf(r.run_at))} {timeOf(r.run_at)}</b> <span className="muted">· {r.trigger === 'daily' ? 'daily' : 'manual'} · imported {r.imported}{r.imported_names ? ` (${r.imported_names})` : ''}</span></div>
                      <div className="xs muted">{r.lines_added || 0} lines added{r.skipped ? ` · skipped: ${r.skipped}` : ''}</div>
                      {r.errors && <div className="xs" style={{ color: 'var(--ember)' }}>{r.errors}</div>}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </>
  );
}
