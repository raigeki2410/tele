import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { emptySnapshot, type AccountRecord, type CoreSnapshot, type DeliveryRecord, type RouteRecord, type UnifiedEvent } from './contracts.js';
import { openCoreDatabase, type CoreDatabase } from './db.js';

export class SqliteCorePersistence {
  private readonly db: CoreDatabase;
  constructor(public readonly filePath: string) { this.db = openCoreDatabase(filePath); }
  close(): void { this.db.close(); }
  get data(): CoreSnapshot {
    const accounts = this.db.prepare('SELECT platform, account_id AS accountId, enabled, created_at AS createdAt FROM accounts').all().map(x => { const row = x as { platform: AccountRecord['platform']; accountId: string; enabled: number; createdAt: string }; return { platform: row.platform, accountId: row.accountId, enabled: Boolean(row.enabled), createdAt: row.createdAt }; }) as AccountRecord[];
    const routes = this.db.prepare('SELECT route_id AS routeId, platform, account_id AS accountId, conversation_id AS conversationId, telegram_bot_id AS telegramBotId, telegram_group_id AS telegramGroupId, thread_id AS threadId, owner FROM routes').all() as RouteRecord[];
    const events = this.db.prepare('SELECT payload_json AS payload FROM events ORDER BY created_at').all().map(x => JSON.parse((x as { payload: string }).payload) as UnifiedEvent);
    const deliveries = this.db.prepare('SELECT event_id AS eventId, route_id AS routeId, state, attempts, updated_at AS updatedAt, error FROM deliveries').all() as DeliveryRecord[];
    return { version: 1, accounts, routes, events, deliveries };
  }
  addAccount(record: AccountRecord): void { this.db.prepare('INSERT OR IGNORE INTO accounts(platform, account_id, enabled, created_at) VALUES (?, ?, ?, ?)').run(record.platform, record.accountId, record.enabled ? 1 : 0, record.createdAt); }
  addRoute(record: RouteRecord): void {
    const conflict = this.db.prepare('SELECT route_id FROM routes WHERE telegram_bot_id=? AND telegram_group_id=? AND thread_id=? AND route_id<>?').get(record.telegramBotId, record.telegramGroupId, record.threadId, record.routeId) as { route_id: string } | undefined;
    if (conflict) throw new Error(`Telegram topic already owned by ${conflict.route_id}`);
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM routes WHERE route_id=? OR (platform=? AND account_id=? AND conversation_id=?)').run(record.routeId, record.platform, record.accountId, record.conversationId);
      this.db.prepare('INSERT INTO routes(route_id, platform, account_id, conversation_id, telegram_bot_id, telegram_group_id, thread_id, owner) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(record.routeId, record.platform, record.accountId, record.conversationId, record.telegramBotId, record.telegramGroupId, record.threadId, record.owner);
    });
    tx();
  }
  appendEvent(event: UnifiedEvent): boolean { const result = this.db.prepare('INSERT OR IGNORE INTO events(event_id, idempotency_key, payload_json, created_at) VALUES (?, ?, ?, ?)').run(event.eventId, event.idempotencyKey, JSON.stringify(event), event.receivedAt); return result.changes > 0; }
  upsertDelivery(record: DeliveryRecord): void { this.db.prepare('INSERT INTO deliveries(event_id, route_id, state, attempts, updated_at, error) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(event_id, route_id) DO UPDATE SET state=excluded.state, attempts=excluded.attempts, updated_at=excluded.updated_at, error=excluded.error').run(record.eventId, record.routeId, record.state, record.attempts, record.updatedAt, record.error ?? null); }
  backup(): string { const backup = `${this.filePath}.json`; mkdirSync(path.dirname(backup), { recursive: true }); writeFileSync(backup, JSON.stringify(this.data, null, 2)); return backup; }
  restore(backupPath: string): void { if (!existsSync(backupPath)) throw new Error(`Backup not found: ${backupPath}`); const snapshot = JSON.parse(readFileSync(backupPath, 'utf8')) as CoreSnapshot; if (snapshot.version !== 1) throw new Error('Unsupported core snapshot'); const tx = this.db.transaction(() => { for (const account of snapshot.accounts) this.addAccount(account); for (const route of snapshot.routes) this.addRoute(route); for (const event of snapshot.events) this.appendEvent(event); for (const delivery of snapshot.deliveries) this.upsertDelivery(delivery); }); tx(); }
}

export const emptySqliteSnapshot = (): CoreSnapshot => emptySnapshot();