import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export type ReportMessage = {
  instance: string;
  platform: 'zalo' | 'whatsapp';
  groupId: string;
  sender: string;
  text: string;
  timestamp: string;
};

export type ReportSummary = {
  generatedAt: string;
  period: { start: string; end: string };
  messages: number;
  groups: Record<string, number>;
  senders: Record<string, number>;
  items: ReportMessage[];
};

export function reportFile(dataDir: string): string {
  return path.join(dataDir, 'report-messages.jsonl');
}

export function appendReportMessage(dataDir: string, message: Omit<ReportMessage, 'timestamp'> & { timestamp?: string }): void {
  const text = message.text.trim();
  if (!text || !message.instance || !message.groupId) return;
  const row: ReportMessage = {
    ...message,
    text,
    timestamp: message.timestamp || new Date().toISOString(),
  };
  mkdirSync(dataDir, { recursive: true });
  appendFileSync(reportFile(dataDir), JSON.stringify(row) + '\n', { encoding: 'utf8' });
}

export function readReportMessages(dataDir: string): ReportMessage[] {
  const file = reportFile(dataDir);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split(/\r?\n/).flatMap(line => {
    if (!line.trim()) return [];
    try {
      const row = JSON.parse(line) as ReportMessage;
      return row && typeof row.text === 'string' && typeof row.timestamp === 'string' ? [row] : [];
    } catch { return []; }
  });
}

export function summarizeReport(messages: ReportMessage[], start: Date, end: Date): ReportSummary {
  const items = messages.filter(item => {
    const time = Date.parse(item.timestamp);
    return Number.isFinite(time) && time >= start.getTime() && time <= end.getTime();
  });
  const groups: Record<string, number> = {};
  const senders: Record<string, number> = {};
  for (const item of items) {
    groups[item.groupId] = (groups[item.groupId] || 0) + 1;
    senders[item.sender] = (senders[item.sender] || 0) + 1;
  }
  return { generatedAt: new Date().toISOString(), period: { start: start.toISOString(), end: end.toISOString() }, messages: items.length, groups, senders, items };
}

if (process.env.REPORTING_SELF_CHECK === '1') {
  const summary = summarizeReport([{ instance: 'x', platform: 'zalo', groupId: 'g', sender: 's', text: 'hello', timestamp: '2024-01-01T00:00:00.000Z' }], new Date('2023-12-31'), new Date('2024-01-02'));
  if (summary.messages !== 1 || summary.groups.g !== 1) throw new Error('reporting self-check failed');
}

export default reportFile;
