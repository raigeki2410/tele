/**
 * Single-window supervisor for every Zalo instance, with a live dashboard.
 *
 * - Runs each folder under instances/ that contains a .env as its own child
 *   process with cwd = instances/<name>, so the app loads that instance's .env.
 * - Rescans instances/ every few seconds (polling is more reliable than
 *   fs.watch on Windows):
 *       new folder + .env  -> started automatically (no manager restart)
 *       folder removed     -> that instance is stopped
 *       .env modified      -> that instance is restarted (picks up new config)
 * - When stdout is a TTY this renders a dashboard (account / process / Telegram /
 *   Zalo / uptime / restarts) plus the most recent log lines. Every line is also
 *   appended to logs/<name>.log. When stdout is NOT a TTY (piped, run-log.bat)
 *   it falls back to plain prefixed log lines. Force that with NO_DASHBOARD=1.
 *
 * Usage:  node manager.mjs              manage every instance (hot-add ON)
 *         node manager.mjs account1     manage only that instance (fixed)
 */
import { spawn } from 'node:child_process';
import { readdirSync, existsSync, mkdirSync, createWriteStream, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const INSTANCES_DIR = path.join(ROOT, 'instances');
const LOGS_DIR = path.join(ROOT, 'logs');
const ENTRY = path.join(ROOT, 'dist', 'index.js');
const POLL_MS = 3000;
const RENDER_MS = 1000;
const FAST_EXIT_MS = 10_000;
const RECENT_LINES = 10;

if (!existsSync(ENTRY)) {
  console.error('[manager] dist/index.js not found - run: npm run build');
  process.exit(1);
}

const fixedName = process.argv[2] || null;
if (fixedName && !existsSync(path.join(INSTANCES_DIR, fixedName, '.env'))) {
  console.error(`[manager] Unknown instance "${fixedName}".`);
  process.exit(1);
}

mkdirSync(LOGS_DIR, { recursive: true });
const DASHBOARD = process.env.NO_DASHBOARD !== '1'
  && (process.stdout.isTTY === true || process.env.FORCE_DASHBOARD === '1');

// Every instance must be driven PURELY by its own .env. dotenv only overrides
// keys that exist in .env, so a missing key would otherwise silently fall back
// to whatever the manager inherited from its parent shell.
const CONFIG_KEYS = [
  'TG_TOKEN', 'TG_GROUP_ID', 'TG_LOCAL_SERVER', 'TG_API_ID', 'TG_API_HASH',
  'LOCAL_BOT_API', 'ZALO_CREDENTIALS_PATH', 'DATA_DIR', 'ZALO_SKIP_MUTED_GROUPS',
  'ZALO_EXCLUDE_THREADS', 'ZALO_MUTE_SILENT', 'ZALO_DM_NATIVE_REACTION',
  'TG_MEDIA_SPOILER',
];

function childEnv() {
  const env = { ...process.env, ZALO_TG_RUNNER: '1' };
  for (const key of CONFIG_KEYS) delete env[key];
  return env;
}

const children = new Map();   // name -> { child, envMtime, startedAt, restarts, ... }
const status = new Map();     // name -> dashboard fields
const recent = [];            // ring buffer of prefixed log lines
let shuttingDown = false;

function setStatus(name, patch) {
  const s = status.get(name) ?? {
    running: false, telegram: 'unknown', zalo: 'unknown',
    startedAt: null, restarts: 0, lastLineAt: null,
  };
  Object.assign(s, patch);
  status.set(name, s);
}

function pushRecent(line) {
  recent.push(line);
  while (recent.length > RECENT_LINES) recent.shift();
}

function discover() {
  if (!existsSync(INSTANCES_DIR)) return [];
  const names = readdirSync(INSTANCES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && existsSync(path.join(INSTANCES_DIR, d.name, '.env')))
    .map(d => d.name)
    .sort();
  return fixedName ? names.filter(n => n === fixedName) : names;
}

function envMtime(name) {
  try { return statSync(path.join(INSTANCES_DIR, name, '.env')).mtimeMs; } catch { return 0; }
}

/** Derive dashboard status from the child's own log lines. */
function noteLine(name, text) {
  if (text.includes('TELEGRAM') && text.includes('polling connected')) setStatus(name, { telegram: 'up' });
  if (text.includes('Telegram polling stopped') || text.includes('polling failure')) setStatus(name, { telegram: 'down' });
  if (text.includes('ZALO LOGIN') && text.includes('authenticated')) setStatus(name, { zalo: 'connecting' });
  if (text.includes('listener started')) setStatus(name, { zalo: 'up' });
  if (text.includes('auto-login failed') || text.includes('Chua dang nhap Zalo') || text.includes('Chưa đăng nhập Zalo')) {
    setStatus(name, { zalo: 'no-login' });
  }
  if (text.includes('Failed to connect') || text.includes('credentials.json')) setStatus(name, { zalo: 'no-login' });
  setStatus(name, { lastLineAt: Date.now() });
}

function start(name) {
  if (shuttingDown) return;
  const cwd = path.join(INSTANCES_DIR, name);
  const log = createWriteStream(path.join(LOGS_DIR, `${name}.log`), { flags: 'a' });
  log.write(`\n=== ${new Date().toISOString()} starting ${name} ===\n`);

  const child = spawn(process.execPath, ['--disable-warning=DEP0205', ENTRY], {
    cwd,
    env: childEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const startedAt = Date.now();
  const prev = status.get(name);
  children.set(name, { child, envMtime: envMtime(name), startedAt });
  setStatus(name, {
    running: true, telegram: 'connecting', zalo: 'connecting', startedAt,
    restarts: prev?.restarts ?? 0,
  });

  const tag = `[${name}]`;
  const relay = (out, buf) => {
    const text = buf.toString();
    log.write(text);
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      noteLine(name, line);
      if (DASHBOARD) pushRecent(`${tag} ${line}`);
      else out.write(`${tag} ${line}\n`);
    }
  };
  child.stdout.on('data', b => relay(process.stdout, b));
  child.stderr.on('data', b => relay(process.stderr, b));

  child.on('exit', (code) => {
    log.end();
    children.delete(name);
    setStatus(name, { running: false, telegram: 'down', startedAt: null });

    if (shuttingDown) return;
    if (code === 43 || code === 42) {
      const ranMs = Date.now() - startedAt;
      const delay = ranMs < FAST_EXIT_MS ? FAST_EXIT_MS : 1500;
      const restarts = (status.get(name)?.restarts ?? 0) + 1;
      setStatus(name, { restarts, telegram: 'restarting' });
      pushRecent(`${tag} restarting in ${delay / 1000}s (exit ${code})`);
      setTimeout(() => start(name), delay);
    } else {
      pushRecent(`${tag} stopped (exit ${code})`);
    }
  });

  if (!DASHBOARD) console.log(`${tag} started (pid ${child.pid}) - log: logs\\${name}.log`);
}

function stop(name) {
  const entry = children.get(name);
  if (!entry) return;
  try { entry.child.kill(); } catch { /* already gone */ }
}

function reconcile() {
  if (shuttingDown) return;
  const current = discover();

  for (const name of [...children.keys()]) {
    if (!current.includes(name)) {
      pushRecent(`[manager] "${name}" folder gone - stopping it`);
      stop(name);
    } else if (envMtime(name) !== children.get(name).envMtime) {
      pushRecent(`[manager] "${name}" .env changed - restarting to apply config`);
      stop(name);
    }
  }

  for (const name of current) {
    // `children` still holds a name until its process actually exits, which also
    // prevents restarting an instance that is being stopped.
    if (!children.has(name)) start(name);
  }
}

function fmtUptime(ms) {
  if (!ms || ms < 0) return '-';
  const s = Math.floor(ms / 1000);
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${sec}`;
}

function label(v) {
  switch (v) {
    case 'up': return 'connected';
    case 'connecting': return 'connecting';
    case 'restarting': return 'restarting';
    case 'down': return 'DOWN';
    case 'no-login': return 'not-logged-in';
    default: return '-';
  }
}

function render() {
  if (!DASHBOARD) return;
  const names = discover();
  const rows = names.map(n => {
    const s = status.get(n) ?? {};
    return [
      n.padEnd(14),
      (s.running ? 'running' : 'stopped').padEnd(9),
      label(s.telegram).padEnd(12),
      label(s.zalo).padEnd(14),
      fmtUptime(s.startedAt ? Date.now() - s.startedAt : 0).padEnd(8),
      String(s.restarts ?? 0),
    ].join(' ');
  });

  const running = names.filter(n => status.get(n)?.running).length;
  const head = [
    `zalo-tg manager   ${running}/${names.length} running   ${new Date().toLocaleTimeString()}   Ctrl+C = stop all`,
    '-'.repeat(74),
    'ACCOUNT        PROC      TELEGRAM     ZALO           UPTIME   RESTARTS',
    ...(rows.length ? rows : ['(no instances)']),
    '-'.repeat(74),
  ];

  process.stdout.write('\x1b[H\x1b[J' + head.concat(recent).join('\n') + '\n');
}

for (const name of discover()) start(name);

if (DASHBOARD) {
  process.stdout.write('\x1b[?25l'); // hide cursor
  setInterval(render, RENDER_MS);
  render();
} else {
  console.log(`[manager] mode: ${fixedName ? `single (${fixedName})` : 'all instances'}`);
  console.log('[manager] Press Ctrl+C to stop everything.');
}

setInterval(reconcile, POLL_MS);

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (DASHBOARD) process.stdout.write('\x1b[?25h\n\x1b[J');
  console.log('\n[manager] stopping all instances...');
  for (const [, entry] of children) {
    try { entry.child.kill(); } catch { /* already gone */ }
  }
  setTimeout(() => process.exit(0), 2000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
