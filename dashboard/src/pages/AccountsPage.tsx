import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { createAccount, deleteAccount, getAccounts, requestAccountReconnect, restartAccount, startAccountLogin, updateAccount } from '../api';

type Account = { id: string; platform: string; instance: string; authStatus: string; connectionHealth: string; lastActivity: string | null; error: string | null; isEnabled: boolean };

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({ name: '', token: '', groupId: '', type: 'zalo' });
  const load = () => getAccounts().then(setAccounts).catch(() => setMessage('Cannot connect to Control API'));
  useEffect(() => { load(); const timer = window.setInterval(load, 5000); return () => window.clearInterval(timer); }, []);
  const act = async (kind: string, account: Account) => {
    setBusy(account.id); setMessage('');
    try {
      if (kind === 'login') await startAccountLogin(account.id);
      else if (kind === 'reconnect') await requestAccountReconnect(account.id);
      else if (kind === 'restart') await restartAccount(account.id);
      else if (kind === 'delete') { if (!window.confirm(`Delete instance ${account.instance}?`)) return; await deleteAccount(account.instance); }
      else await updateAccount(account.id, { isEnabled: !account.isEnabled });
      setMessage(account.id + ': ' + kind + ' requested'); await load();
    } catch { setMessage(account.id + ': action failed'); } finally { setBusy(''); }
  };
  const add = async (event: FormEvent) => {
    event.preventDefault(); setBusy('add'); setMessage('');
    try { await createAccount(form); setForm({ name: '', token: '', groupId: '', type: 'zalo' }); setMessage('Account created. Manager will start bridge within seconds.'); await load(); }
    catch (error: any) { setMessage(error?.response?.data?.error || 'Create account failed'); }
    finally { setBusy(''); }
  };
  return <div className='space-y-5'>
    <section className='rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200'>
      <h2 className='text-lg font-semibold'>Quick add account</h2>
      <p className='mt-1 text-sm text-slate-500'>Creates instances/&lt;name&gt;/.env. Manager auto-detects it.</p>
      <form onSubmit={add} className='mt-4 grid gap-3 md:grid-cols-4'>
        <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className='rounded border px-3 py-2 text-sm'>
          <option value='zalo'>Zalo</option>
          <option value='whatsapp'>WhatsApp</option>
          <option value='wechat' disabled>WeChat (not supported)</option>
          <option value='tammi' disabled>Tammi (not supported)</option>
        </select>
        <input required pattern='[A-Za-z0-9_-]{1,40}' placeholder='Instance name' value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className='rounded border px-3 py-2 text-sm' />
        <input required placeholder='Telegram bot token' value={form.token} onChange={e => setForm({ ...form, token: e.target.value })} className='rounded border px-3 py-2 text-sm md:col-span-2' />
        <input required placeholder='Telegram group ID' value={form.groupId} onChange={e => setForm({ ...form, groupId: e.target.value })} className='rounded border px-3 py-2 text-sm' />
        <button disabled={busy === 'add'} className='rounded bg-indigo-600 px-3 py-2 text-sm text-white disabled:opacity-50 md:col-span-4'>{busy === 'add' ? 'Creating…' : 'Add account'}</button>
      </form>
    </section>
    <div className='flex items-center justify-between'><div><p className='text-sm text-slate-500'>Live inventory</p><h2 className='text-2xl font-bold'>{accounts.length} accounts · {new Set(accounts.map(a => a.instance)).size} bridges</h2></div>{message && <p className='text-sm text-slate-600'>{message}</p>}</div>
    <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>{accounts.map(a => <article key={a.id} className='rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200'><div className='flex items-start justify-between'><div><Link className='font-semibold text-indigo-700' to={'/accounts/' + a.id}>{a.id}</Link><p className='mt-1 text-xs uppercase tracking-wide text-slate-400'>{a.platform} · {a.instance}</p></div><span className={'rounded-full px-2 py-1 text-xs ' + (a.connectionHealth === 'running' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700')}>{a.connectionHealth}</span></div><dl className='mt-5 grid grid-cols-2 gap-3 text-sm'><div><dt className='text-slate-400'>Auth</dt><dd>{a.authStatus}</dd></div><div><dt className='text-slate-400'>Enabled</dt><dd>{a.isEnabled ? 'Yes' : 'No'}</dd></div><div className='col-span-2'><dt className='text-slate-400'>Last activity</dt><dd>{a.lastActivity ? new Date(a.lastActivity).toLocaleString() : '—'}</dd></div></dl>{a.error && <p className='mt-3 truncate rounded bg-red-50 p-2 text-xs text-red-700'>{a.error}</p>}<div className='mt-5 flex flex-wrap gap-2'><button disabled={busy === a.id} onClick={() => act('restart', a)} className='rounded bg-indigo-600 px-3 py-2 text-sm text-white disabled:opacity-50'>{busy === a.id ? 'Working…' : 'Restart bridge'}</button><button disabled={busy === a.id} onClick={() => act('reconnect', a)} className='rounded border px-3 py-2 text-sm'>Reconnect</button>{a.platform === 'zalo' && <button disabled={busy === a.id} onClick={() => act('login', a)} className='rounded border px-3 py-2 text-sm'>Login</button>}<button disabled={busy === a.id} onClick={() => act('delete', a)} className='rounded border border-red-300 px-3 py-2 text-sm text-red-700'>Delete bridge</button></div></article>)}</div>
  </div>;
}
