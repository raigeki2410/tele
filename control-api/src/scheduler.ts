import fs from 'fs';
import path from 'path';
import { loadSettings, summary as reportSummary } from './reporting';

function matches(value: number, field: string, min: number, max: number): boolean {
  return field.split(',').some(part => {
    const [base, stepText] = part.split('/');
    const step = stepText ? Number(stepText) : 1;
    if (!Number.isInteger(step) || step < 1) return false;
    if (base === '*') return value >= min && value <= max && (value - min) % step === 0;
    const exact = Number(base);
    return Number.isInteger(exact) && exact >= min && exact <= max && value === exact;
  });
}

export function cronMatches(schedule: string, date = new Date()): boolean {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [minute, hour, day, month, weekday] = fields;
  return matches(date.getMinutes(), minute, 0, 59) && matches(date.getHours(), hour, 0, 23) &&
    matches(date.getDate(), day, 1, 31) && matches(date.getMonth() + 1, month, 1, 12) &&
    matches(date.getDay(), weekday, 0, 6);
}

export function startScheduler(instancesDir: string): NodeJS.Timeout {
  let lastRun = '';
  return setInterval(() => {
    const settings = loadSettings();
    if (!settings.REPORT_SCHEDULE) return;
    const now = new Date();
    const minuteKey = now.toISOString().slice(0, 16);
    if (minuteKey === lastRun || !cronMatches(settings.REPORT_SCHEDULE, now)) return;
    lastRun = minuteKey;
    const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const report = reportSummary(settings.REPORT_STORAGE_PATH, instancesDir, settings.REPORT_INSTANCES, start, now);
    const dir = path.resolve(settings.REPORT_STORAGE_PATH);
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, `scheduled-report-${minuteKey.replace(/[:]/g, '-')}.json`);
    const temp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(report, null, 2), 'utf8');
    fs.renameSync(temp, target);
    console.log(`[scheduler] report written: ${target}`);
  }, 60_000);
}
