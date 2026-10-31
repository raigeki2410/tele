import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { rmSync } from 'node:fs';
import { openCoreDatabase } from '../src/core/db.js';
import { SqliteCorePersistence } from '../src/core/sqlitePersistence.js';
import { createEvent } from '../src/core/contracts.js';

function event(id: string) { const now = new Date().toISOString(); return createEvent({ platform: 'zalo', account: 'a', conversation: 'c', message: id, externalMessageId: id, senderId: 's', direction: 'inbound', type: 'text', text: 'x', occurredAt: now, receivedAt: now, source: 'platform' }); }

test('SQLite initializes WAL schema and persists core snapshot across reopen', () => {
  const dir = path.join(os.tmpdir(), `core-sqlite-${process.pid}-${Date.now()}`); const file = path.join(dir, 'core.db');
  const persistence = new SqliteCorePersistence(file); const e = event('m1');
  persistence.addAccount({ platform: 'zalo', accountId: 'a', enabled: true, createdAt: e.receivedAt });
  persistence.addRoute({ routeId: 'r1', platform: 'zalo', accountId: 'a', conversationId: 'c', telegramBotId: 'b', telegramGroupId: 'g', threadId: 1, owner: 'test' });
  assert.equal(persistence.appendEvent(e), true); assert.equal(persistence.appendEvent(e), false); persistence.close();
  const reopened = new SqliteCorePersistence(file); assert.equal(reopened.data.events.length, 1); assert.equal(reopened.data.routes[0].threadId, 1); const checkDb = openCoreDatabase(file); assert.equal(checkDb.pragma('journal_mode', { simple: true }), 'wal'); checkDb.close(); reopened.close(); rmSync(dir, { recursive: true, force: true });
});