import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getAccount, updateAccount } from '../api';

type Account = { id: string; platform: string; authStatus: string; connectionHealth: string; isEnabled: boolean; settings: Record<string, unknown> };
export default function AccountDetailsPage() {
  const { id = '' } = useParams(); const [account, setAccount] = useState<Account | null>(null); const [json, setJson] = useState('{}'); const [message, setMessage] = useState('');
  useEffect(() => { getAccount(id).then((a: Account) => { setAccount(a); setJson(JSON.stringify(a.settings, null, 2)); }); }, [id]);
  const save = async () => { try { const settings = JSON.parse(json); const updated = await updateAccount(id, { settings }); setAccount(updated); setMessage('Saved'); } catch { setMessage('Invalid JSON'); } };
  if (!account) return <p>Loading...</p>;
  return <div className="max-w-3xl space-y-4"><Link to="/accounts" className="text-indigo-600">Back to accounts</Link><div className="rounded-lg bg-white p-6 shadow"><h2 className="text-xl font-semibold">{account.id}</h2><p className="mt-2 text-slate-600">{account.platform} · {account.authStatus} · {account.connectionHealth}</p><label className="mt-6 block text-sm font-medium">Settings JSON</label><textarea className="mt-2 h-64 w-full rounded border p-3 font-mono text-sm" value={json} onChange={e => setJson(e.target.value)} /><button onClick={save} className="mt-3 rounded bg-indigo-600 px-4 py-2 text-white">Save</button>{message && <span className="ml-3 text-sm">{message}</span>}</div></div>;
}