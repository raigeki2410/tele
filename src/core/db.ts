import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export const SCHEMA_VERSION = 1;

export function openCoreDatabase(filePath: string): Database.Database {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS accounts (platform TEXT NOT NULL, account_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, PRIMARY KEY (platform, account_id));
    CREATE TABLE IF NOT EXISTS routes (route_id TEXT PRIMARY KEY, platform TEXT NOT NULL, account_id TEXT NOT NULL, conversation_id TEXT NOT NULL, telegram_bot_id TEXT NOT NULL, telegram_group_id TEXT NOT NULL, thread_id INTEGER NOT NULL, owner TEXT NOT NULL, UNIQUE (telegram_bot_id, telegram_group_id, thread_id), UNIQUE (platform, account_id, conversation_id));
    CREATE TABLE IF NOT EXISTS events (event_id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS deliveries (event_id TEXT NOT NULL, route_id TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL, updated_at TEXT NOT NULL, error TEXT, PRIMARY KEY (event_id, route_id), FOREIGN KEY (event_id) REFERENCES events(event_id));
    CREATE TABLE IF NOT EXISTS delivery_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL, route_id TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 5, next_retry_at TEXT, leased_until TEXT, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(event_id, route_id), FOREIGN KEY (event_id) REFERENCES events(event_id));
    CREATE INDEX IF NOT EXISTS idx_queue_claim ON delivery_queue(state, next_retry_at, created_at);
  `);
  db.prepare('INSERT OR IGNORE INTO schema_version(version) VALUES (?)').run(SCHEMA_VERSION);
  db.prepare("UPDATE delivery_queue SET state='queued', leased_until=NULL, updated_at=? WHERE state='processing' AND leased_until < ?").run(new Date().toISOString(), new Date().toISOString());
  return db;
}

export type CoreDatabase = Database.Database;
export default openCoreDatabase;