import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { loadSettings, saveSettings, summary as reportSummary } from './reporting';
import { startScheduler } from './scheduler';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const ROOT = path.resolve(__dirname, '../..');
const INSTANCES_DIR = path.join(ROOT, 'instances');
const LOGS_DIR = path.join(ROOT, 'logs');

function getInstanceType(instance: string): 'zalo' | 'whatsapp' {
    const typeFile = path.join(INSTANCES_DIR, instance, '.type');
    if (fs.existsSync(typeFile)) {
        const content = fs.readFileSync(typeFile, 'utf8').trim().toLowerCase();
        if (content === 'whatsapp' || content === 'wa') return 'whatsapp';
        if (content === 'zalo' || content === 'zalo-tg') return 'zalo';
    }
    return 'zalo';
}

function instanceNames(): string[] {
    return fs.existsSync(INSTANCES_DIR)
        ? fs.readdirSync(INSTANCES_DIR).filter(name => fs.existsSync(path.join(INSTANCES_DIR, name, '.env'))).sort()
        : [];
}

type Process = { id: string; status: string; pid: number | null; restarts: number; instance: string };
type Account = { id: string; platform: string; instance: string; authStatus: string; connectionHealth: string; lastActivity: string | null; error: string | null; settings: Record<string, any>; isEnabled: boolean };
const processState = new Map<string, { restarts: number; requestedAt?: string }>();
const metricHistory: Array<{ timestamp: string; messagesIn: number; messagesOut: number; queueBacklog: number; errors: number }> = [];

function instanceLog(instance: string): string {
    try { return fs.readFileSync(path.join(LOGS_DIR, `${instance}.log`), 'utf8').slice(-12000); } catch { return ''; }
}
function instanceState(instance: string) {
    const log = instanceLog(instance);
    const lines = log.split(/\r?\n/).filter(Boolean);
    const lastIndex = (pattern: RegExp) => { for (let i = lines.length - 1; i >= 0; i--) if (pattern.test(lines[i])) return i; return -1; };
    const tgUp = lastIndex(/polling connected/i);
    const tgDown = lastIndex(/Telegram polling stopped|polling failure|Telegram.*(?:failed|error)/i);
    const zaloUp = lastIndex(/listener started/i);
    const zaloDown = lastIndex(/Zalo disconnected|listener closed|reconnect failed|auto-login failed|ENOTFOUND wpa\.chat\.zalo\.me/i);
    const noLogin = lastIndex(/no-login|credentials\.json|ChÃƒâ€ Ã‚Â°a Ãƒâ€žÃ¢â‚¬ËœÃƒâ€žÃ†â€™ng nhÃƒÂ¡Ã‚ÂºÃ‚Â­p Zalo|Chua dang nhap Zalo/i);
    const telegram = tgUp >= 0 && tgUp > tgDown ? 'connected' : tgDown >= 0 ? 'disconnected' : 'unknown';
    const zalo = zaloUp >= 0 && zaloUp > Math.max(zaloDown, noLogin) ? 'connected' : noLogin > zaloDown ? 'not_authenticated' : zaloDown >= 0 ? 'disconnected' : 'unknown';
    const failureIndex = Math.max(tgDown, zaloDown);
    const error = failureIndex >= 0 && failureIndex > Math.max(tgUp, zaloUp) ? lines[failureIndex] : null;
    const status = telegram === 'connected' && zalo === 'connected' ? 'running' : error ? 'degraded' : 'unknown';
    return { status, telegram, zalo, lastActivity: fs.existsSync(path.join(LOGS_DIR, `${instance}.log`)) ? fs.statSync(path.join(LOGS_DIR, `${instance}.log`)).mtime.toISOString() : null, error };
}
function discoverAccounts(): Account[] {
    return instanceNames().flatMap(instance => {
        const type = getInstanceType(instance);
        const state = instanceState(instance);
        return [
            { id: `${instance}:telegram`, platform: 'telegram', instance, authStatus: state.telegram === 'connected' ? 'authenticated' : 'unknown', connectionHealth: state.status, lastActivity: state.lastActivity, error: state.error, settings: {}, isEnabled: true },
            ...(type === 'whatsapp' ? [{ id: `${instance}:whatsapp`, platform: 'whatsapp', instance, authStatus: state.zalo === 'connected' ? 'authenticated' : 'unknown', connectionHealth: state.status, lastActivity: state.lastActivity, error: state.error, settings: {}, isEnabled: true }] : [{ id: `${instance}:zalo`, platform: 'zalo', instance, authStatus: state.zalo === 'connected' ? 'logged_in' : 'unknown', connectionHealth: state.status, lastActivity: state.lastActivity, error: state.error, settings: {}, isEnabled: true }]),
        ];
    });
}
function discoverProcesses(): Process[] { return instanceNames().map(instance => { const state = instanceState(instance); const saved = processState.get(instance) ?? { restarts: 0 }; return { id: instance, instance, status: state.status, pid: null, restarts: saved.restarts }; }); }
function restartInstance(instance: string): boolean {
    if (!instanceNames().includes(instance)) return false;
    const envFile = path.join(INSTANCES_DIR, instance, '.env');
    const now = new Date();
    fs.utimesSync(envFile, now, now);
    const saved = processState.get(instance) ?? { restarts: 0 };
    processState.set(instance, { restarts: saved.restarts + 1, requestedAt: now.toISOString() });
    pushLog('info', `Restart requested for ${instance}`, 'supervisor');
    return true;
}

let workerStatus = { pid: null as number | null, uptime: null as number | null, lastConnection: null as string | null, lastReconnect: null as string | null, activeAccounts: instanceNames().length * 2, conversations: 0, telegramTopics: 0, messagesIn: 0, messagesOut: 0, deliveryErrors: 0, queueBacklog: 0, appVersion: process.env.npm_package_version || '1.0.0', lastFailure: null as { timestamp: string; message: string } | null, restartCount: 0, health: instanceNames().length ? 'healthy' : 'unknown', managedProcesses: [] as Process[] };
let accounts = discoverAccounts();
let logs = [{ timestamp: new Date().toISOString(), level: 'info', message: `Discovered ${instanceNames().length} supervised instances`, module: 'system' }];
function pushLog(level: string, message: string, module: string) { logs.push({ timestamp: new Date().toISOString(), level, message, module }); if (logs.length > 200) logs.shift(); }
setInterval(() => { accounts = discoverAccounts(); workerStatus.managedProcesses = discoverProcesses(); workerStatus.activeAccounts = accounts.length; workerStatus.uptime = (workerStatus.uptime || 0) + 5000; workerStatus.messagesIn += Math.floor(Math.random() * 20); workerStatus.messagesOut += Math.floor(Math.random() * 20); workerStatus.queueBacklog = Math.max(0, workerStatus.queueBacklog + Math.floor(Math.random() * 5) - 3); metricHistory.push({ timestamp: new Date().toISOString(), messagesIn: workerStatus.messagesIn, messagesOut: workerStatus.messagesOut, queueBacklog: workerStatus.queueBacklog, errors: workerStatus.deliveryErrors }); if (metricHistory.length > 60) metricHistory.shift(); }, 5000);

// --- Middleware ---
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5174', 'http://127.0.0.1:5174'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    credentials: true
}));
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Authentication ---
const isAuthenticated = (req: Request, res: Response, next: NextFunction) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey === process.env.API_KEY) {
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
    }
};

const isAgentAuthenticated = (req: Request, res: Response, next: NextFunction) => {
    const settings = loadSettings();
    const apiKey = req.headers['x-agent-api-key'] || req.headers['x-api-key'];
    // Priority: settings (managed via dashboard) > env var (fallback)
    const expected = settings.AGENT_API_KEY || process.env.AGENT_API_KEY || process.env.API_KEY;
    if (expected && apiKey === expected) next();
    else res.status(401).json({ error: 'Unauthorized: Invalid agent API key' });
};

// --- Routes ---
app.get('/api/health', (req: Request, res: Response) => {
    res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// AI agents use this isolated key. Keep AGENT_API_KEY separate from dashboard API_KEY in production.
app.get('/api/agent/status', isAgentAuthenticated, (req: Request, res: Response) => {
    res.json({ health: workerStatus.health, accounts: discoverAccounts(), managedProcesses: discoverProcesses() });
});

app.get('/api/agent/reports/summary', isAgentAuthenticated, (req: Request, res: Response) => {
    const settings = loadSettings();
    const selected = typeof req.query.instances === 'string' ? String(req.query.instances).split(',').map(x => x.trim()).filter(Boolean) : settings.REPORT_INSTANCES;
    const end = req.query.until ? new Date(String(req.query.until)) : new Date();
    const start = req.query.since ? new Date(String(req.query.since)) : new Date(end.getTime() - 24 * 60 * 60 * 1000);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) return res.status(400).json({ error: 'Invalid report date range' });
    res.json(reportSummary(settings.REPORT_STORAGE_PATH, INSTANCES_DIR, selected, start, end));
});

app.get('/api/system/status', isAuthenticated, (req: Request, res: Response) => {
    workerStatus.managedProcesses = discoverProcesses();
    res.status(200).json({ ...workerStatus, accounts: discoverAccounts() });
});

app.get('/api/metrics/history', isAuthenticated, (req: Request, res: Response) => {
    res.status(200).json({ simulated: true, samples: metricHistory });
});

app.get('/api/accounts', isAuthenticated, (req: Request, res: Response) => {
    res.status(200).json(discoverAccounts());
});

app.post('/api/accounts', isAuthenticated, (req: Request, res: Response) => {
    const name = String(req.body?.name || '').trim();
    const token = String(req.body?.token || '').trim();
    const groupId = String(req.body?.groupId || '').trim();
    const rawType = String(req.body?.type || 'zalo').toLowerCase();
    let type: string = rawType;
    if (type === 'wechat' || type === 'tammi') {
        return res.status(400).json({ error: `${type} is not supported yet` });
    }
    // normalize supported types
    if (type !== 'whatsapp') type = 'zalo';
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(name)) return res.status(400).json({ error: 'Name must use 1-40 letters, numbers, hyphens, or underscores' });
    if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) return res.status(400).json({ error: 'Valid Telegram bot token required' });
    if (!/^-?\d+$/.test(groupId)) return res.status(400).json({ error: 'Valid Telegram group ID required' });
    const dir = path.join(INSTANCES_DIR, name);
    const envFile = path.join(dir, '.env');
    if (fs.existsSync(envFile)) return res.status(409).json({ error: 'Instance already exists' });
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    // write .type file
    fs.writeFileSync(path.join(dir, '.type'), type, 'utf8');
    const envLines = [
        `# Instance: ${name}`,
        '# Created from Dashboard. Manager discovers this file automatically.',
        `TG_TOKEN=${token}`,
        `TG_GROUP_ID=${groupId}`,
        `DATA_DIR=${path.join(dir, 'data')}`,
        'LOCAL_BOT_API=0',
    ];
    if (type === 'whatsapp') {
        envLines.push(`WA_ACCOUNT_ID=${name}`);
    } else {
        envLines.push(`ZALO_CREDENTIALS_PATH=${path.join(dir, 'credentials.json')}`);
    }
    envLines.push('');
    fs.writeFileSync(envFile, envLines.join('\n'), { encoding: 'utf8', flag: 'wx' });
    accounts = discoverAccounts();
    pushLog('info', `Created ${type} instance ${name}`, 'account-manager');
    res.status(201).json({ instance: name, type, accounts: discoverAccounts() });
});

app.delete('/api/accounts/:id', isAuthenticated, async (req: Request, res: Response) => {
    const rawId = String(req.params.id || '').trim();
    const instance = rawId.split(':')[0];
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(instance)) return res.status(400).json({ error: 'Invalid instance name' });
    const dir = path.join(INSTANCES_DIR, instance);
    const envFile = path.join(dir, '.env');
    if (!fs.existsSync(envFile)) return res.status(404).json({ error: 'Instance not found' });

    // Remove .env first. manager.mjs detects this and stops child process.
    try { fs.unlinkSync(envFile); } catch (error) { return res.status(500).json({ error: 'Failed to stop instance', detail: String(error) }); }
    let lastError: unknown;
    for (let attempt = 0; attempt < 10; attempt++) {
        try {
            fs.rmSync(dir, { recursive: true, force: true });
            if (!fs.existsSync(dir)) {
                accounts = discoverAccounts();
                pushLog('info', `Removed instance ${instance}`, 'account-manager');
                return res.status(204).send();
            }
        } catch (error) { lastError = error; }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    return res.status(409).json({ error: 'Instance stopped but files are still locked', detail: String(lastError || '') });
});

app.get('/api/accounts/:id', isAuthenticated, (req: Request, res: Response) => {
    const account = accounts.find(acc => acc.id === req.params.id);
    if (account) res.status(200).json(account);
    else res.status(404).json({ error: 'Account not found' });
});

app.post('/api/accounts/:id/login', isAuthenticated, (req: Request, res: Response) => {
    const account = accounts.find(acc => acc.id === req.params.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    if (account.platform === 'zalo') {
        pushLog('info', `Login initiated for Zalo account ${req.params.id}`, 'account-manager');
        account.authStatus = 'pending_login';
        account.connectionHealth = 'pending';
        res.status(200).json({ message: 'Login process started. Please check Zalo for QR code.', accountId: req.params.id, newStatus: 'pending_login' });
    } else {
        res.status(400).json({ error: `Login not supported for platform: ${account.platform}` });
    }
});

app.post('/api/accounts/:id/restart', isAuthenticated, (req: Request, res: Response) => {
    const account = discoverAccounts().find(item => item.id === req.params.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    if (!restartInstance(account.instance)) return res.status(400).json({ error: 'Instance is not supervised' });
    return res.status(202).json({ accountId: account.id, instance: account.instance, status: 'restarting' });
});

app.post('/api/accounts/:id/reconnect', isAuthenticated, (req: Request, res: Response) => {
    const account = accounts.find(acc => acc.id === req.params.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    pushLog('info', `Reconnect initiated for account ${req.params.id}`, 'account-manager');
    account.authStatus = 'reconnecting';
    account.connectionHealth = 'reconnecting';
    setTimeout(() => {
        account.authStatus = 'logged_in';
        account.connectionHealth = 'good';
        pushLog('info', `Account ${req.params.id} reconnected`, 'account-manager');
        workerStatus.lastReconnect = new Date().toISOString();
    }, 2000);
    res.status(200).json({ message: 'Reconnect process started', accountId: req.params.id, newStatus: 'reconnecting' });
});

app.patch('/api/accounts/:id', isAuthenticated, (req: Request, res: Response) => {
    const account = accounts.find(acc => acc.id === req.params.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    const { isEnabled, settings } = req.body;
    if (isEnabled !== undefined) {
        account.isEnabled = isEnabled;
        pushLog('info', `Account ${req.params.id} enabled status set to ${isEnabled}`, 'account-manager');
    }
    if (settings) {
        account.settings = { ...account.settings, ...settings };
        pushLog('info', `Settings updated for account ${req.params.id}`, 'account-manager');
    }
    res.status(200).json(account);
});

app.get('/api/conversations', isAuthenticated, (req: Request, res: Response) => {
    res.status(200).json([
        { id: 'conv-1', platform: 'zalo', accountId: 'zalo-account-1', lastActivity: new Date(Date.now() - 100000).toISOString(), topic: 'general', routingStatus: 'ok' },
        { id: 'conv-2', platform: 'telegram', accountId: 'telegram-bot-1', lastActivity: new Date(Date.now() - 50000).toISOString(), topic: 'support-topic-123', routingStatus: 'ok' },
    ]);
});

app.get('/api/routes', isAuthenticated, (req: Request, res: Response) => {
    res.status(200).json([
        { id: 'route-1', from: 'zalo-account-1', to: 'telegram-bot-1', topic: 'general', status: 'active' },
        { id: 'route-2', from: 'telegram-bot-1', to: 'zalo-account-1', topic: 'general', status: 'active' },
    ]);
});
function handleWorkerAction(req: Request, res: Response, action: 'start'|'stop'|'restart') {
    const { id } = req.params;
    if (action !== 'restart') return res.status(405).json({ error: 'Only restart is supported by manager' });
    if (!restartInstance(id)) return res.status(404).json({ error: `Instance ${id} not found` });
    res.status(202).json({ message: `Restart requested for ${id}`, status: 'restarting' });
}

app.post('/api/workers/:id/start', isAuthenticated, (req, res) => handleWorkerAction(req, res, 'start'));
app.post('/api/workers/:id/stop', isAuthenticated, (req, res) => handleWorkerAction(req, res, 'stop'));
app.post('/api/workers/:id/restart', isAuthenticated, (req, res) => handleWorkerAction(req, res, 'restart'));

app.get('/api/logs', isAuthenticated, (req: Request, res: Response) => {
    const { level, module, search, limit = '50' } = req.query;
    let filteredLogs = [...logs];
    if (level) filteredLogs = filteredLogs.filter(l => l.level === level);
    if (module) filteredLogs = filteredLogs.filter(l => l.module === module);
    if (search) {
        const term = String(search).toLowerCase();
        filteredLogs = filteredLogs.filter(l => l.message.toLowerCase().includes(term));
    }
    res.status(200).json(filteredLogs.slice(-Number(limit)).reverse());
});

app.get('/api/report-instances', isAuthenticated, (req: Request, res: Response) => {
    res.json({ instances: instanceNames() });
});

app.get('/api/reports/settings', isAuthenticated, (req: Request, res: Response) => {
    res.json(loadSettings());
});

app.patch('/api/reports/settings', isAuthenticated, (req: Request, res: Response) => {
    const body = req.body || {};
    const settings = saveSettings({
        REPORT_STORAGE_PATH: typeof body.REPORT_STORAGE_PATH === 'string' && body.REPORT_STORAGE_PATH.trim() ? body.REPORT_STORAGE_PATH.trim() : undefined,
        REPORT_SCHEDULE: typeof body.REPORT_SCHEDULE === 'string' ? body.REPORT_SCHEDULE.trim() : undefined,
        REPORT_TIMEZONE: typeof body.REPORT_TIMEZONE === 'string' && body.REPORT_TIMEZONE.trim() ? body.REPORT_TIMEZONE.trim() : undefined,
        REPORT_INSTANCES: Array.isArray(body.REPORT_INSTANCES) ? body.REPORT_INSTANCES.map((x: unknown) => String(x)).filter((x: string) => /^[a-zA-Z0-9_-]{1,40}$/.test(x)) : undefined,
        REPORT_TELEGRAM_CHAT_ID: typeof body.REPORT_TELEGRAM_CHAT_ID === 'string' ? body.REPORT_TELEGRAM_CHAT_ID.trim() : undefined,
        AGENT_API_KEY: typeof body.AGENT_API_KEY === 'string' ? body.AGENT_API_KEY.trim() : undefined,
    });
    res.json(settings);
});

app.post('/api/reports/generate-key', isAuthenticated, (req: Request, res: Response) => {
    const settings = saveSettings({ AGENT_API_KEY: crypto.randomBytes(32).toString('hex') });
    res.json({ AGENT_API_KEY: settings.AGENT_API_KEY });
});

app.get('/api/reports/download', isAuthenticated, (req: Request, res: Response) => {
    const settings = loadSettings();
    const selected = typeof req.query.instances === 'string' ? String(req.query.instances).split(',').map(x => x.trim()).filter(x => instanceNames().includes(x)) : settings.REPORT_INSTANCES.filter(x => instanceNames().includes(x));
    const end = req.query.until ? new Date(String(req.query.until)) : new Date();
    const start = req.query.since ? new Date(String(req.query.since)) : new Date(end.getTime() - 24 * 60 * 60 * 1000);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) return res.status(400).json({ error: 'Invalid report date range' });
    const report = reportSummary(settings.REPORT_STORAGE_PATH, INSTANCES_DIR, selected, start, end);
    const dir = path.resolve(settings.REPORT_STORAGE_PATH);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(dir, `report-${stamp}.json`);
    const temp = `${target}.${process.pid}.tmp`;
    try { fs.writeFileSync(temp, JSON.stringify(report, null, 2), 'utf8'); fs.renameSync(temp, target); } catch (error) { try { fs.rmSync(temp, { force: true }); } catch {} return res.status(500).json({ error: 'Failed to write report' }); }
    res.download(target, path.basename(target));
});

app.get('/api/reports/summary', isAuthenticated, (req: Request, res: Response) => {
    const settings = loadSettings();
    const selected = typeof req.query.instances === 'string' ? String(req.query.instances).split(',').map(x => x.trim()).filter(Boolean) : settings.REPORT_INSTANCES;
    const end = req.query.until ? new Date(String(req.query.until)) : new Date();
    const start = req.query.since ? new Date(String(req.query.since)) : new Date(end.getTime() - 24 * 60 * 60 * 1000);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) return res.status(400).json({ error: 'Invalid report date range' });
    res.json(reportSummary(settings.REPORT_STORAGE_PATH, INSTANCES_DIR, selected, start, end));
});

app.get('/api/settings', isAuthenticated, (req: Request, res: Response) => {
    const runtimeSettings = {
        DATA_DIR: process.env.DATA_DIR || './data',
        TG_TOKEN_AVAILABLE: !!process.env.TG_TOKEN,
        ZALO_CREDENTIALS_PATH: process.env.ZALO_CREDENTIALS_PATH || './credentials.json',
        HOT_RELOAD_ENABLED: true,
        RESTART_REQUIRED_CONFIG: (process.env.RESTART_REQUIRED_CONFIG || 'TG_TOKEN,ZALO_CREDENTIALS_PATH').split(','),
    };
    const accountSpecificSettings = accounts.reduce((acc, account) => { acc[account.id] = account.settings; return acc; }, {} as Record<string, any>);
    res.status(200).json({ ...runtimeSettings, ...accountSpecificSettings });
});

app.patch('/api/settings', isAuthenticated, (req: Request, res: Response) => {
    const { settings, accountId } = req.body;
    if (!settings) return res.status(400).json({ error: 'No settings provided' });
    if (accountId) {
        const account = accounts.find(acc => acc.id === accountId);
        if (!account) return res.status(404).json({ error: 'Account not found' });
        account.settings = { ...account.settings, ...settings };
        pushLog('info', `Updated settings for account ${accountId}`, 'settings');
    } else {
        const restartRequiredKeys = (process.env.RESTART_REQUIRED_CONFIG || 'TG_TOKEN,ZALO_CREDENTIALS_PATH').split(',');
        let requiresRestart = false;
        for (const key in settings) {
            pushLog('info', `Attempted to update runtime setting: ${key}=${settings[key]}`, 'settings');
            if (restartRequiredKeys.includes(key)) requiresRestart = true;
        }
        if (requiresRestart) pushLog('warn', 'Some runtime settings require a worker restart.', 'settings');
    }
    res.status(200).json({ message: 'Settings updated', updatedSettings: settings });
});

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

const scheduler = startScheduler(INSTANCES_DIR);
app.listen(PORT, () => {
    console.log(`Control API listening on http://localhost:${PORT}`);
    workerStatus.managedProcesses.forEach(p => {
        if (Math.random() < 0.2) {
            p.status = 'running';
            p.pid = Math.floor(Math.random() * 10000) + 1000;
            if (p.id === 'zalo-worker') { workerStatus.lastConnection = new Date().toISOString(); workerStatus.health = 'healthy'; }
        }
    });
    console.log(`Initial simulated worker status: ${JSON.stringify(workerStatus.managedProcesses)}`);
});



