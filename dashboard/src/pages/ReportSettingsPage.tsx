import { useEffect, useState } from 'react';
import { getReportSettings, updateReportSettings, getReportSummary, downloadReport, getReportInstances } from '../api';

type Settings = { REPORT_STORAGE_PATH?: string; REPORT_SCHEDULE?: string; REPORT_TIMEZONE?: string; REPORT_INSTANCES?: string[]; REPORT_TELEGRAM_CHAT_ID?: string; AGENT_API_KEY?: string };
type Summary = { summary: { totalMessages: number; byInstance: Record<string, number>; instances: string[] }; };

export default function ReportSettingsPage() {
  const [settings, setSettings] = useState<Settings>({});
  const [message, setMessage] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [instances, setInstances] = useState<string[]>([]);

  useEffect(() => { Promise.all([getReportSettings(), getReportInstances()]).then(([saved, available]) => { setSettings(saved); setInstances(available); }).catch(() => setMessage('Failed to load report settings')); }, []);
  const set = (key: keyof Settings, value: string) => setSettings(old => ({ ...old, [key]: value }));
  const toggleInstance = (name: string) => setSettings(old => { const selected = old.REPORT_INSTANCES || []; return { ...old, REPORT_INSTANCES: selected.includes(name) ? selected.filter(x => x !== name) : [...selected, name] }; });
  const save = async () => { try { await updateReportSettings(settings); setMessage('Settings saved'); } catch { setMessage('Failed to save'); } };
  const generate = () => set('AGENT_API_KEY', crypto.randomUUID() + crypto.randomUUID().slice(1));
  const loadSummary = async () => { setLoading(true); try { setSummary(await getReportSummary({ instances: settings.REPORT_INSTANCES?.join(',') || '' })); setMessage('Summary loaded'); } catch { setMessage('Failed to load summary'); } finally { setLoading(false); } };
  const download = async () => { try { const blob = await downloadReport({ instances: settings.REPORT_INSTANCES?.join(',') || '' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `report_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`; link.click(); URL.revokeObjectURL(url); } catch { setMessage('Download failed'); } };

  return <div className="max-w-4xl space-y-6">
    <h2 className="text-lg font-semibold">Report Settings</h2>
    {message && <p className="rounded bg-indigo-50 p-2 text-sm text-indigo-700">{message}</p>}
    <section className="space-y-4 rounded-lg bg-white p-5 shadow">
      <h3 className="font-medium">Storage & Schedule</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Storage Path" value={settings.REPORT_STORAGE_PATH || ''} placeholder="D:\\OneDrive - raigeki241\\Work" onChange={v => set('REPORT_STORAGE_PATH', v)} />
        <Field label="Schedule" value={settings.REPORT_SCHEDULE || ''} placeholder="0 0 * * *" onChange={v => set('REPORT_SCHEDULE', v)} />
        <Field label="Timezone" value={settings.REPORT_TIMEZONE || 'Asia/Ho_Chi_Minh'} placeholder="Asia/Ho_Chi_Minh" onChange={v => set('REPORT_TIMEZONE', v)} />
        <Field label="Telegram Chat ID" value={settings.REPORT_TELEGRAM_CHAT_ID || ''} placeholder="-1001234567890" onChange={v => set('REPORT_TELEGRAM_CHAT_ID', v)} />
      </div>
    </section>
    <section className="space-y-4 rounded-lg bg-white p-5 shadow">
      <h3 className="font-medium">API Access (AI Agents)</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Agent API Key" value={settings.AGENT_API_KEY || ''} placeholder="Leave empty to use .env fallback" onChange={v => set('AGENT_API_KEY', v)} />
        <div className="flex items-end"><button type="button" onClick={generate} className="rounded bg-amber-600 px-3 py-2 text-sm text-white">Generate New Key</button></div>
      </div>
      <p className="text-xs text-slate-500">Use <code>X-Agent-API-Key</code> header for <code>/api/agent/*</code>. Save an empty key to use <code>.env</code> fallback.</p>
    </section>
    <section className="space-y-3 rounded-lg bg-white p-5 shadow">
      <h3 className="font-medium">Instances</h3>
      <div className="grid gap-2 sm:grid-cols-3">{instances.map(name => <label key={name} className="flex items-center gap-2 rounded border p-2 text-sm"><input type="checkbox" checked={settings.REPORT_INSTANCES?.includes(name) || false} onChange={() => toggleInstance(name)} />{name}</label>)}</div>
      {!instances.length && <p className="text-sm text-slate-500">No instances found.</p>}
    </section>
    <section className="flex gap-3 rounded-lg bg-white p-5 shadow">
      <button onClick={save} className="rounded bg-indigo-600 px-4 py-2 text-white">Save Settings</button>
      <button onClick={loadSummary} disabled={loading} className="rounded bg-emerald-600 px-4 py-2 text-white disabled:opacity-50">{loading ? 'Loading...' : 'Load Summary'}</button>
      <button onClick={download} className="rounded bg-slate-600 px-4 py-2 text-white">Download JSON</button>
    </section>
    {summary && <section className="rounded-lg bg-white p-5 shadow"><h3 className="font-medium">Report Summary</h3><p>Total messages: <b>{summary.summary.totalMessages}</b></p><pre className="mt-3 overflow-auto rounded bg-slate-50 p-3 text-xs">{JSON.stringify(summary.summary.byInstance, null, 2)}</pre></section>}
  </div>;
}

function Field({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (value: string) => void }) {
  return <label className="block text-sm text-slate-500">{label}<input className="mt-1 w-full rounded border p-2 text-sm text-slate-900" value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} /></label>;
}