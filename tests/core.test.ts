import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createEvent, CoreRouter, CorePersistence, dryRunLegacyMigration, type UnifiedEvent } from '../src/core/index.js';

const base = (overrides: Partial<UnifiedEvent> = {}): UnifiedEvent => createEvent({
  platform: 'zalo', account: 'account-a', conversation: 'conversation-a', message: 'message-a', externalMessageId: 'external-a',
  senderId: 'sender-a', direction: 'inbound', type: 'text', text: 'hello', occurredAt: new Date().toISOString(), receivedAt: new Date().toISOString(), source: 'platform', ...overrides,
});

test('UnifiedEvent identity and idempotency include platform, account, conversation and message', () => {
  const one = base(); const two = base({ account: 'account-b' });
  assert.notEqual(one.idempotencyKey, two.idempotencyKey);
  assert.throws(() => createEvent({ ...one, conversation: '' }), /missing required identity/);
});

test('CoreRouter deduplicates inbound replay and blocks echo delivery', async () => {
  const file = path.join(os.tmpdir(), `core-${process.pid}-${Date.now()}.json`); const persistence = new CorePersistence(file);
  persistence.addRoute({ routeId: 'r1', platform: 'zalo', accountId: 'account-a', conversationId: 'conversation-a', telegramBotId: 'bot', telegramGroupId: 'group', threadId: 10, owner: 'test' });
  const sent: string[] = []; const router = new CoreRouter(persistence, async (_route, event) => { sent.push(event.externalMessageId); });
  assert.equal(await router.ingest(base()), true); assert.equal(await router.ingest(base()), false); assert.deepEqual(sent, ['external-a']);
  assert.equal(await router.ingest(base({ source: 'telegram', externalMessageId: 'external-b', message: 'message-b' })), true); assert.deepEqual(sent, ['external-a']);
});

test('legacy migration preserves Zalo/Tammi ownership and reports topic conflicts', () => {
  const result = dryRunLegacyMigration({ topics: [{ topicId: 10, zaloId: 'z', type: 1, name: 'Z' }], tammi: [{ topicId: 11, conversationId: 't', conversationType: 'peer', name: 'T' }] }, 'bot', 'group');
  assert.equal(result.conflicts.length, 0); assert.deepEqual(result.routes.map(x => x.platform), ['zalo', 'tammi']);
  const conflict = dryRunLegacyMigration({ topics: [{ topicId: 10, zaloId: 'z', type: 1, name: 'Z' }], tammi: [{ topicId: 10, conversationId: 't', conversationType: 'peer', name: 'T' }] }, 'bot', 'group');
  assert.deepEqual(conflict.conflicts, ['bot:group:10']); assert.equal(conflict.routes.length, 1);
});

test('persistence backup and restore rollback state', () => {
  const file = path.join(os.tmpdir(), `core-rollback-${process.pid}-${Date.now()}.json`); const persistence = new CorePersistence(file);
  persistence.addAccount({ platform: 'zalo', accountId: 'a', enabled: true, createdAt: new Date().toISOString() }); const backup = persistence.backup();
  persistence.addAccount({ platform: 'tammi', accountId: 'b', enabled: true, createdAt: new Date().toISOString() }); persistence.restore(backup);
  assert.deepEqual(persistence.data.accounts.map(x => x.accountId), ['a']);
});
