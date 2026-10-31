import { useEffect, useState } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { getSystemStatus } from './api';
import OverviewPage from './pages/OverviewPage';
import AccountsPage from './pages/AccountsPage';
import AccountDetailsPage from './pages/AccountDetailsPage';
import ConversationsPage from './pages/ConversationsPage';
import LogsPage from './pages/LogsPage';
import SettingsPage from './pages/SettingsPage';
import ReportSettingsPage from './pages/ReportSettingsPage';

const navigation = [
  ['Overview', '/'], ['Accounts', '/accounts'], ['Conversations', '/conversations'], ['Logs', '/logs'], ['Settings', '/settings'], ['Reports', '/reports'],
] as const;

export default function App() {
  const [health, setHealth] = useState('unknown');
  const location = useLocation();
  useEffect(() => {
    const intervalMs = Number(import.meta.env.VITE_HEALTH_POLL_INTERVAL_MS) || 15000;
    const load = () => getSystemStatus().then(data => setHealth(data.health)).catch(() => setHealth('error'));
    load(); const timer = window.setInterval(load, intervalMs); return () => window.clearInterval(timer);
  }, []);
  const page = navigation.find(([, href]) => href === location.pathname)?.[0] || 'TELE Dashboard';
  return <div className="min-h-screen lg:flex">
    <aside className="bg-slate-900 text-white lg:min-h-screen lg:w-64 p-5">
      <Link to="/" className="text-2xl font-bold text-indigo-300">TELE</Link>
      <nav className="mt-8 space-y-1">{navigation.map(([name, href]) => <Link key={href} to={href} className={`block rounded px-3 py-2 ${location.pathname === href ? 'bg-indigo-600' : 'text-slate-300 hover:bg-slate-800'}`}>{name}</Link>)}</nav>
    </aside>
    <section className="min-w-0 flex-1"><header className="flex h-16 items-center justify-between bg-white px-6 shadow"><h1 className="text-xl font-semibold text-slate-900">{page}</h1><span className={`rounded-full px-3 py-1 text-sm ${health === 'healthy' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{health}</span></header><main className="p-6"><Routes><Route path="/" element={<OverviewPage />} /><Route path="/accounts" element={<AccountsPage />} /><Route path="/accounts/:id" element={<AccountDetailsPage />} /><Route path="/conversations" element={<ConversationsPage />} /><Route path="/logs" element={<LogsPage />} /><Route path="/settings" element={<SettingsPage />} /><Route path="/reports" element={<ReportSettingsPage />} /></Routes></main></section>
  </div>;
}