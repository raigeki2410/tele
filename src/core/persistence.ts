import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { emptySnapshot, type CoreSnapshot, type UnifiedEvent, type RouteRecord, type AccountRecord, type DeliveryRecord } from './contracts.js';

export class CorePersistence {
  private snapshot: CoreSnapshot;
  constructor(private readonly filePath: string) { this.snapshot = this.load(); }
  private load(): CoreSnapshot {
    if (!existsSync(this.filePath)) return emptySnapshot();
    try { const value = JSON.parse(readFileSync(this.filePath, 'utf8')) as CoreSnapshot; return value.version === 1 ? value : emptySnapshot(); }
    catch { return emptySnapshot(); }
  }
  private save(): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.snapshot, null, 2), 'utf8');
    renameSync(tmp, this.filePath);
  }
  get data(): CoreSnapshot { return structuredClone(this.snapshot); }
  addAccount(record: AccountRecord): void { if (!this.snapshot.accounts.some(x => x.platform === record.platform && x.accountId === record.accountId)) this.snapshot.accounts.push(record); this.save(); }
  addRoute(record: RouteRecord): void {
    const topicOwner = this.snapshot.routes.find(x => x.telegramBotId === record.telegramBotId && x.telegramGroupId === record.telegramGroupId && x.threadId === record.threadId && x.routeId !== record.routeId);
    if (topicOwner) throw new Error(`Telegram topic already owned by ${topicOwner.routeId}`);
    this.snapshot.routes = this.snapshot.routes.filter(x => x.routeId !== record.routeId && !(x.platform === record.platform && x.accountId === record.accountId && x.conversationId === record.conversationId));
    this.snapshot.routes.push(record); this.save();
  }
  appendEvent(event: UnifiedEvent): boolean { if (this.snapshot.events.some(x => x.idempotencyKey === event.idempotencyKey || x.eventId === event.eventId)) return false; this.snapshot.events.push(event); this.save(); return true; }
  upsertDelivery(record: DeliveryRecord): void { const index = this.snapshot.deliveries.findIndex(x => x.eventId === record.eventId && x.routeId === record.routeId); if (index < 0) this.snapshot.deliveries.push(record); else this.snapshot.deliveries[index] = record; this.save(); }
  backup(): string { const backup = `${this.filePath}.bak`; mkdirSync(path.dirname(this.filePath), { recursive: true }); writeFileSync(backup, JSON.stringify(this.snapshot, null, 2), 'utf8'); return backup; }
  restore(backupPath: string): void { const restored = JSON.parse(readFileSync(backupPath, 'utf8')) as CoreSnapshot; if (restored.version !== 1) throw new Error('Unsupported core snapshot'); this.snapshot = restored; this.save(); }
}

export interface LegacyMigrationInput { topics: Array<{ topicId: number; zaloId: string; type: 0 | 1; name: string }>; tammi: Array<{ topicId: number; conversationId: string; conversationType: string; name: string }> }
export function dryRunLegacyMigration(input: LegacyMigrationInput, telegramBotId: string, telegramGroupId: string): { routes: RouteRecord[]; conflicts: string[] } {
  const routes: RouteRecord[] = []; const conflicts: string[] = []; const seen = new Set<string>();
  const candidates: Array<Pick<RouteRecord, 'platform' | 'accountId' | 'conversationId' | 'threadId'>> = [
    ...input.topics.map(x => ({ platform: 'zalo' as const, accountId: 'legacy-zalo', conversationId: `${x.type}:${x.zaloId}`, threadId: x.topicId })),
    ...input.tammi.map(x => ({ platform: 'tammi' as const, accountId: 'legacy-tammi', conversationId: x.conversationId, threadId: x.topicId })),
  ];
  for (const item of candidates) {
    const key = `${telegramBotId}:${telegramGroupId}:${item.threadId}`;
    if (seen.has(key)) { conflicts.push(key); continue; } seen.add(key);
    routes.push({ routeId: `${item.platform}:${item.accountId}:${item.conversationId}`, platform: item.platform, accountId: item.accountId, conversationId: item.conversationId, telegramBotId, telegramGroupId, threadId: item.threadId, owner: 'core-phase1' });
  }
  return { routes, conflicts };
}
