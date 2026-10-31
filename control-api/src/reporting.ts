import fs from 'fs';
import path from 'path';

export type ReportMessage = { instance: string; platform: string; groupId: string; sender: string; text: string; timestamp: string };
export type ReportSettings = { REPORT_STORAGE_PATH: string; REPORT_SCHEDULE: string; REPORT_TIMEZONE: string; REPORT_INSTANCES: string[]; REPORT_TELEGRAM_CHAT_ID: string; AGENT_API_KEY: string };

export const defaultSettings: ReportSettings = {
  REPORT_STORAGE_PATH: process.env.REPORT_STORAGE_PATH || 'D:\\OneDrive - raigeki241\\Work',
  REPORT_SCHEDULE: process.env.REPORT_SCHEDULE || '',
  REPORT_TIMEZONE: process.env.REPORT_TIMEZONE || 'Asia/Ho_Chi_Minh',
  REPORT_INSTANCES: (process.env.REPORT_INSTANCES || '').split(',').map(x => x.trim()).filter(Boolean),
  REPORT_TELEGRAM_CHAT_ID: process.env.REPORT_TELEGRAM_CHAT_ID || '',
  AGENT_API_KEY: process.env.AGENT_API_KEY || '',
};
const settingsFile = path.resolve(__dirname, '../data/report-settings.json');
export function loadSettings(): ReportSettings { try { return { ...defaultSettings, ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')) }; } catch { return { ...defaultSettings }; } }
export function saveSettings(patch: Partial<ReportSettings>): ReportSettings { const next = { ...loadSettings(), ...patch }; fs.mkdirSync(path.dirname(settingsFile), { recursive: true }); const tmp = `${settingsFile}.tmp`; fs.writeFileSync(tmp, JSON.stringify(next, null, 2)); fs.renameSync(tmp, settingsFile); return next; }

function envValue(file: string, key: string): string { try { const line = fs.readFileSync(file, 'utf8').split(/\r?\n/).find(x => x.startsWith(`${key}=`)); return line?.slice(key.length + 1).trim() || ''; } catch { return ''; } }
function dataDirs(instancesDir: string, selected: string[]): Array<{ instance: string; dir: string }> { return fs.existsSync(instancesDir) ? fs.readdirSync(instancesDir).filter(instance => !selected.length || selected.includes(instance)).flatMap(instance => { const env = path.join(instancesDir, instance, '.env'); if (!fs.existsSync(env)) return []; return [{ instance, dir: envValue(env, 'DATA_DIR') || path.join(instancesDir, instance, 'data') }]; }) : []; }
export function summary(storagePath: string, instancesDir: string, selected: string[], start: Date, end: Date) {
  const items: ReportMessage[] = [];
  for (const { instance, dir } of dataDirs(instancesDir, selected)) { const file = path.join(dir, 'report-messages.jsonl'); if (!fs.existsSync(file)) continue; for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) { try { const row = JSON.parse(line) as ReportMessage; const time = Date.parse(row.timestamp); if (row.text && Number.isFinite(time) && time >= start.getTime() && time <= end.getTime()) items.push({ ...row, instance }); } catch { /* skip malformed line */ } } }
  const groups: Record<string, number> = {}; const senders: Record<string, number> = {}; for (const item of items) { groups[item.groupId] = (groups[item.groupId] || 0) + 1; senders[item.sender] = (senders[item.sender] || 0) + 1; }
  return { generatedAt: new Date().toISOString(), period: { start: start.toISOString(), end: end.toISOString() }, messages: items.length, groups, senders, items, storagePath };
}
