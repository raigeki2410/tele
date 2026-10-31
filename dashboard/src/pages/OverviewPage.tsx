import { useEffect, useState } from 'react';
import { getSystemStatus, restartWorkerProcess, startWorkerProcess, stopWorkerProcess, getMetricHistory } from '../api';

type Process = { id: string; status: string; pid: number | null; restarts: number; instance?: string };
type Account = { id: string; platform: string; instance: string; authStatus: string; connectionHealth: string; lastActivity: string | null; error: string | null; isEnabled: boolean };
type Status = { health: string; uptime: number | null; messagesIn: number; messagesOut: number; deliveryErrors: number; queueBacklog: number; appVersion: string; lastFailure: { message: string } | null; managedProcesses: Process[]; accounts?: Account[] };
type HistorySample = { timestamp: string; messagesIn: number; messagesOut: number; queueBacklog: number; errors: number };

export default function OverviewPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [history, setHistory] = useState<HistorySample[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const load = () => Promise.all([getSystemStatus(), getMetricHistory()])
    .then(([s, h]) => { setStatus(s); setHistory(h.samples || []); setError(''); })
    .catch(() => setError('Cannot connect to Control API'));
  useEffect(() => {
    const intervalMs = Number(import.meta.env.VITE_POLL_INTERVAL_MS) || 10000;
    load(); const t = window.setInterval(load, intervalMs); return () => window.clearInterval(t);
  }, []);
  const act = async (id: string, name: string) => { setBusy(id); try { if (name === 'start') await startWorkerProcess(id); else if (name === 'stop') await stopWorkerProcess(id); else await restartWorkerProcess(id); await load(); } finally { setBusy(''); } };
  if (error) return <p className="rounded bg-red-100 p-4 text-red-700">{error}</p>;
  if (!status) return <p>Loading...</p>;

  const metrics = [
    ['Health', status.health],
    ['Messages in', status.messagesIn],
    ['Messages out', status.messagesOut],
    ['Queue backlog', status.queueBacklog],
    ['Delivery errors', status.deliveryErrors],
    ['Version', status.appVersion],
    ['Bridges', status.managedProcesses.length],
    ['Accounts', status.accounts?.length ?? 0],
  ];

  const W = 280, H = 100, M = 10;
  const buildPath = (arr: number[], max: number) => {
    if (!arr.length) return '';
    const stepX = (W - 2 * M) / (arr.length - 1 || 1);
    return `M${M} ${H - M - (arr[0] / (max || 1)) * (H - 2 * M)} ` +
      arr.slice(1).map((v, i) => `L${M + (i + 1) * stepX} ${H - M - (v / (max || 1)) * (H - 2 * M)}`).join(' ');
  };
  const series = (key: keyof HistorySample) => history.map(h => h[key] as number);
  const msgInPath = buildPath(series('messagesIn'), Math.max(...series('messagesIn'), 1));
  const msgOutPath = buildPath(series('messagesOut'), Math.max(...series('messagesOut'), 1));
  const queuePath = buildPath(series('queueBacklog'), Math.max(...series('queueBacklog'), 1));
  const errPath = buildPath(series('errors'), Math.max(...series('errors'), 1));

  const statusColor = (s: string) => s === 'running' ? 'bg-emerald-100 text-emerald-700' : s === 'degraded' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700';

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(([label, value]) => (
          <div key={label} className="rounded-lg bg-white p-5 shadow">
            <p className="text-sm text-slate-500">{label}</p>
            <p className="mt-2 text-2xl font-semibold">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {status.managedProcesses.map(proc => (
          <div key={proc.id} className="rounded-lg bg-white p-5 shadow">
            <div className="flex justify-between">
              <h2 className="font-semibold">{proc.id}</h2>
              <span className={"rounded-full px-2 py-1 text-xs " + statusColor(proc.status)}>{proc.status}</span>
            </div>
            <p className="my-3 text-sm text-slate-500">Restarts: {proc.restarts}</p>
            <div className="flex gap-2">
              {['restart'].map(name => (
                <button key={name} disabled={busy === proc.id} onClick={() => act(proc.id, name)} className="rounded bg-indigo-600 px-3 py-2 text-sm text-white disabled:opacity-50">
                  {busy === proc.id ? 'Working…' : name}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {status.accounts && status.accounts.length > 0 && (
        <section>
          <h3 className="mb-3 font-semibold">Accounts</h3>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {status.accounts.map(acc => (
              <article key={acc.id} className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="font-semibold text-indigo-700">{acc.id}</span>
                    <p className="mt-1 text-xs uppercase tracking-wide text-slate-400">{acc.platform} · {acc.instance}</p>
                  </div>
                  <span className={"rounded-full px-2 py-1 text-xs " + (acc.connectionHealth === 'running' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700')}>{acc.connectionHealth}</span>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div><dt className="text-slate-400">Auth</dt><dd>{acc.authStatus}</dd></div>
                  <div><dt className="text-slate-400">Enabled</dt><dd>{acc.isEnabled ? 'Yes' : 'No'}</dd></div>
                </dl>
                {acc.error && <p className="mt-2 truncate rounded bg-red-50 p-2 text-xs text-red-700">{acc.error}</p>}
                <div className="mt-3 flex gap-2">
                  <button disabled={busy === acc.instance} onClick={() => act(acc.instance, 'restart')} className="rounded bg-indigo-600 px-3 py-2 text-sm text-white disabled:opacity-50">
                    {busy === acc.instance ? 'Working…' : 'Restart bridge'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="grid gap-6 md:grid-cols-2">
        {history.length > 0 && (
          <>
            <div className="rounded-lg bg-white p-5 shadow">
              <h4 className="mb-3 font-semibold">Messages in / out</h4>
              <svg width={W} height={H} viewBox={'0 0 ' + W + ' ' + H} className="bg-slate-50 rounded">
                <path d={msgInPath} stroke="#4f46e5" strokeWidth="1.5" fill="none" />
                <path d={msgOutPath} stroke="#059669" strokeWidth="1.5" fill="none" strokeDasharray="4,2" />
              </svg>
              <p className="mt-2 text-xs text-slate-500">Indigo = in · Green = out · {history.length} samples (simulated)</p>
            </div>
            <div className="rounded-lg bg-white p-5 shadow">
              <h4 className="mb-3 font-semibold">Queue backlog</h4>
              <svg width={W} height={H} viewBox={'0 0 ' + W + ' ' + H} className="bg-slate-50 rounded">
                <path d={queuePath} stroke="#dc2626" strokeWidth="1.5" fill="none" />
              </svg>
              <p className="mt-2 text-xs text-slate-500">Red = queued · {history.length} samples (simulated)</p>
            </div>
            <div className="rounded-lg bg-white p-5 shadow">
              <h4 className="mb-3 font-semibold">Error count</h4>
              <svg width={W} height={H} viewBox={'0 0 ' + W + ' ' + H} className="bg-slate-50 rounded">
                <path d={errPath} stroke="#f59e0b" strokeWidth="1.5" fill="none" />
              </svg>
              <p className="mt-2 text-xs text-slate-500">Amber = errors · {history.length} samples (simulated)</p>
            </div>
            <div className="rounded-lg bg-white p-5 shadow">
              <h4 className="mb-3 font-semibold">Account health</h4>
              <div className="flex items-center gap-4">
                <svg width="80" height="80" viewBox="0 0 80 80">
                  <circle cx="40" cy="40" r="32" fill="none" stroke="#e5e7eb" strokeWidth="8" />
                  <circle cx="40" cy="40" r="32" fill="none" stroke="#4f46e5" strokeWidth="8" strokeDasharray={(status.accounts?.filter(a => a.connectionHealth === 'running').length ?? 0) / (status.accounts?.length || 1) * 200} strokeLinecap="round" transform="rotate(-90 40 40)" />
                </svg>
                <div className="text-sm">
                  <p>Running: <span className="font-semibold">{status.accounts?.filter(a => a.connectionHealth === 'running').length ?? 0}</span></p>
                  <p>Degraded: <span className="font-semibold">{status.accounts?.filter(a => a.connectionHealth === 'degraded').length ?? 0}</span></p>
                  <p>Total: <span className="font-semibold">{status.accounts?.length ?? 0}</span></p>
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-500">Donut = healthy ratio</p>
            </div>
          </>
        )}
        {history.length === 0 && (
          <div className="md:col-span-2 rounded-lg bg-amber-50 p-5 text-amber-800">
            Metric history is empty — charts marked simulated. History will fill as the API collects samples.
          </div>
        )}
      </section>

      {status.lastFailure && (
        <div className="rounded bg-amber-100 p-4 text-amber-800">Last failure: {status.lastFailure.message}</div>
      )}
    </div>
  );
}
