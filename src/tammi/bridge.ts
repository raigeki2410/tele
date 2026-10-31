import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { Telegraf } from 'telegraf';
import { config } from '../config.js';

type Mapping = { topicId: number; conversationId: string; conversationType: string; name: string };
type Incoming = Record<string, unknown>;
const file = path.join(config.dataDir, 'tammi-topics.json');
export const tammiBot = config.tammi.telegramToken ? new Telegraf(config.tammi.telegramToken) : undefined;
let mappings: Mapping[] = [];
try { if (existsSync(file)) mappings = JSON.parse(readFileSync(file, 'utf8')) as Mapping[]; } catch { mappings = []; }
let controller: AbortController | undefined;
let lastEventId = '';
let running = false;
let bridgeProcess: ChildProcess | undefined;

export type TammiRawEvent = Incoming & { _rawReceivedAt: string };

const _tammiSubscribers = new Set<(evt: TammiRawEvent) => void>();

export function subscribeTammi(listener: (evt: TammiRawEvent) => void): () => void {
  _tammiSubscribers.add(listener);
  return () => _tammiSubscribers.delete(listener);
}

function emitTammiRaw(payload: Incoming): void {
  const enriched: TammiRawEvent = { ...payload, _rawReceivedAt: new Date().toISOString() };
  for (const cb of _tammiSubscribers) {
    try { cb(enriched); } catch { /* ignore subscriber errors */ }
  }
}

function save(): void {
  mkdirSync(config.dataDir, { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(mappings, null, 2));
  renameSync(`${file}.tmp`, file);
}

function headers(): Record<string, string> {
  return config.tammi.token ? { 'x-bridge-token': config.tammi.token } : {};
}

function endpoint(route: string): string { return `${config.tammi.url}${route}`; }
export async function tammiHealth(): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(endpoint('/health'), { headers: headers(), signal: AbortSignal.timeout(3000) });
    return response.ok ? await response.json() as Record<string, unknown> : null;
  } catch { return null; }
}

async function ensureBridge(): Promise<void> {
  if (await tammiHealth()) return;
  if (bridgeProcess) return;
  const env = { ...process.env };
  delete env.TG_TOKEN;
  delete env.TAMMI_TG_TOKEN;
  bridgeProcess = spawn('hermes-tammi-plugin', ['start'], {
    env,
    shell: process.platform === 'win32',
    windowsHide: true,
    stdio: 'ignore',
  });
  bridgeProcess.on('error', err => {
    console.warn('[Tammi] Cannot start bridge; install hermes-tammi-plugin and log in:', err.message);
    bridgeProcess = undefined;
  });
  bridgeProcess.on('exit', code => {
    console.warn(`[Tammi] Bridge process exited (${code ?? 'unknown'}).`);
    bridgeProcess = undefined;
  });
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await tammiHealth()) return;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  console.warn('[Tammi] Bridge did not become ready; check hermes-tammi-plugin status.');
}
function field(value: unknown): string { return typeof value === 'string' || typeof value === 'number' ? String(value) : ''; }

export function tammiTopic(topicId: number): Mapping | undefined {
  return mappings.find(x => x.topicId === topicId);
}

export function bindTammi(topicId: number, conversationId: string, conversationType = 'peer', name = conversationId): void {
  mappings = mappings.filter(x => x.topicId !== topicId && x.conversationId !== conversationId);
  mappings.push({ topicId, conversationId, conversationType, name });
  save();
}

export function unbindTammi(topicId: number): boolean {
  const before = mappings.length;
  mappings = mappings.filter(x => x.topicId !== topicId);
  if (mappings.length !== before) save();
  return mappings.length !== before;
}

export async function sendTammi(topicId: number, text: string): Promise<void> {
  const mapping = tammiTopic(topicId);
  if (!mapping) throw new Error('Topic chưa liên kết Tammi');
  const response = await fetch(endpoint('/send'), {
    method: 'POST',
    headers: { ...headers(), 'content-type': 'application/json' },
    body: JSON.stringify({ conversationId: mapping.conversationId, conversationType: mapping.conversationType, text }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Tammi HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
}

async function receive(payload: Incoming): Promise<void> {
  emitTammiRaw(payload);
  const conversationId = field(payload.conversationId);
  if (!conversationId) return;
  const sender = field(payload.senderName) || field(payload.senderId) || 'Tammi';
  const text = field(payload.text);
  if (!text || payload.isOwn === true || payload.isSelf === true) return;
  let mapping = mappings.find(x => x.conversationId === conversationId);
  if (!mapping) {
    const name = field(payload.conversationName) || sender;
    if (!tammiBot) return;
    const topic = await tammiBot.telegram.createForumTopic(config.tammi.telegramGroupId, `Tammi · ${name}`.slice(0, 128));
    bindTammi(topic.message_thread_id, conversationId, field(payload.conversationType) || 'peer', name);
    mapping = tammiTopic(topic.message_thread_id);
  }
  if (!mapping) return;
  await tammiBot?.telegram.sendMessage(config.tammi.telegramGroupId, `${sender}: ${text}`.slice(0, 4096), { message_thread_id: mapping.topicId });
}

async function stream(signal: AbortSignal): Promise<void> {
  const response = await fetch(endpoint('/events'), {
    headers: { ...headers(), accept: 'text/event-stream', ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}) },
    signal,
  });
  if (!response.ok || !response.body) throw new Error(`Tammi SSE HTTP ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let boundary: number;
    while ((boundary = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let event = 'message';
      let id = '';
      const data: string[] = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('id:')) id = line.slice(3).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      if (event === 'message' && data.length) {
        try { await receive(JSON.parse(data.join('\n')) as Incoming); }
        catch (err) { console.warn('[Tammi] Event failed:', err); }
      }
      if (id) lastEventId = id;
    }
  }
}

export function startTammi(): void {
  if (!config.tammi.url || !tammiBot || running) return;
  running = true;
  controller = new AbortController();
  const signal = controller.signal;
  void (async () => {
    await ensureBridge();
    while (!signal.aborted) {
      try { await stream(signal); }
      catch (err) { if (!signal.aborted) console.warn('[Tammi] Connection failed:', err); }
      if (!signal.aborted) await new Promise(resolve => setTimeout(resolve, 5000));
    }
    running = false;
  })();
}

export function stopTammi(): void {
  controller?.abort();
  bridgeProcess?.kill();
}
