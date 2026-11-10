import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { CalendarDays, Building2, LayoutDashboard, ListChecks, PanelLeftClose, PanelLeftOpen, Plus, Settings as Cog, Mail } from 'lucide-react';
import { useStore } from './store';
import { iconProps, Modal } from './components/ui';
import { Dashboard } from './pages/Dashboard';
import { Companies } from './pages/Companies';
import { CompanyPage } from './pages/CompanyPage';
import { Logs } from './pages/Logs';
import { Copies } from './pages/Copies';
import { Calendar } from './pages/Calendar';
import { SettingsPage } from './pages/Settings';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/companies', label: 'Companies', icon: Building2 },
  { to: '/logs', label: 'Logs', icon: ListChecks },
  { to: '/copies', label: 'Copies', icon: Mail },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/settings', label: 'Settings', icon: Cog },
];

function NewCompany({ onClose }: { onClose: () => void }) {
  const { mutate } = useStore();
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const res = await mutate<{ id: string }>('saveCompany', { company: { name: name.trim(), industry: industry.trim() } });
    setBusy(false);
    if (res?.id) { onClose(); nav(`/companies/${res.id}`); }
  };
  return (
    <Modal title="New company" onClose={onClose}>
      <form className="col" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div className="field"><label htmlFor="nc-name">Name</label><input id="nc-name" className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label htmlFor="nc-ind">Industry</label><input id="nc-ind" className="input" value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Fintech, health, dev tools" /></div>
        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!name.trim() || busy}>{busy ? 'Creating' : 'Create company'}</button>
        </div>
      </form>
    </Modal>
  );
}

function Rail({ collapsed, setCollapsed, onNew }: { collapsed: boolean; setCollapsed: (v: boolean) => void; onNew: () => void }) {
  const { saving, savedAt } = useStore();
  const [recent, setRecent] = useState(false);
  useEffect(() => {
    if (!savedAt) return;
    setRecent(true);
    const t = setTimeout(() => setRecent(false), 2200);
    return () => clearTimeout(t);
  }, [savedAt]);
  return (
    <aside className="rail" aria-label="Main">
      <div className="rail-top">
        <span className="brand"><span className="brand-mark" /><span className="brand-text">Outreach</span></span>
        <button className="icon-btn" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? <PanelLeftOpen {...iconProps} /> : <PanelLeftClose {...iconProps} />}
        </button>
      </div>
      <button className="btn add-btn" onClick={onNew} aria-label="New company"><Plus {...iconProps} /><span className="add-label">Company</span></button>
      <nav className="nav">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} aria-label={n.label}>
            <n.icon {...iconProps} /><span className="rail-label">{n.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="rail-foot"><span className="save-state" aria-live="polite">{saving ? 'Saving' : recent ? 'Saved' : ''}</span></div>
    </aside>
  );
}

export default function App() {
  const { status, error, reload, toasts, data } = useStore();
  const nav = useNavigate();
  const [newOpen, setNewOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('outreach.rail') === '1'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('outreach.rail', collapsed ? '1' : '0'); } catch { /* ignore */ } }, [collapsed]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"]') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (status !== 'ready') return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); setNewOpen(true); }
      if (e.key === '/') {
        e.preventDefault();
        nav('/companies');
        setTimeout(() => document.getElementById('company-search')?.focus(), 50);
      }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [status, nav]);

  const gated = status === 'unconfigured';
  return (
    <div className={`app ${collapsed ? 'collapsed' : ''}`}>
      <Rail collapsed={collapsed} setCollapsed={setCollapsed} onNew={() => setNewOpen(true)} />
      <main className="main">
        <div className="page">
          {status === 'loading' && !data && <div className="center-screen"><div className="loading-line" role="status" aria-label="Loading" /></div>}
          {status === 'error' && !data && (
            <div className="empty">
              <p>Could not load your data. {error}</p>
              <button className="btn" onClick={() => reload()}>Try again</button>
            </div>
          )}
          {gated && <SettingsPage />}
          {status === 'ready' && (
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/companies" element={<Companies onNew={() => setNewOpen(true)} />} />
              <Route path="/companies/:id" element={<CompanyPage />} />
              <Route path="/logs" element={<Logs />} />
              <Route path="/copies" element={<Copies />} />
              <Route path="/calendar" element={<Calendar />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          )}
        </div>
      </main>
      {newOpen && <NewCompany onClose={() => setNewOpen(false)} />}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
      </div>
    </div>
  );
}
