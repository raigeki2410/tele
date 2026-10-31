import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { rmSync } from 'node:fs';
import { openCoreDatabase } from '../src/core/db.js';
import { DurableQueue } from '../src/core/queue.js';
import { createEvent } from '../src/core/contracts.js';

function event(id: string) { const now = new Date().toISOString(); return createEvent({ platform: 'tammi', account: 'a', conversation: 'c', message: id, externalMessageId: id, senderId: 's', direction: 'inbound', type: 'text', text: id, occurredAt: now, receivedAt: now, source: 'platform' }); }

test('durable queue deduplicates, claims, completes and recovers expired leases', () => {
  const dir = path.join(os.tmpdir(), `core-queue-${process.pid}-${Date.now()}`); const db = openCoreDatabase(path.join(dir, 'queue.db')); const queue = new DurableQueue(db, 1);
  const e = event('m1'); db.prepare('INSERT INTO events(event_id, idempotency_key, payload_json, created_at) VALUES (?, ?, ?, ?)').run(e.eventId, e.idempotencyKey, JSON.stringify(e), e.receivedAt);
  assert.equal(queue.enqueue(e, 'r1'), true); assert.equal(queue.enqueue(e, 'r1'), false);
  const item = queue.claimNext(); assert.ok(item); assert.equal(item?.state, 'processing'); queue.complete(item!.id); assert.equal(queue.claimNext(), undefined);
  db.prepare("UPDATE delivery_queue SET state='processing', leased_until=? WHERE id=?").run(new Date(Date.now() - 10).toISOString(), item!.id); assert.equal(queue.recover(), 1); db.close(); rmSync(dir, { recursive: true, force: true });
});