import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { openCoreDatabase } from '../../src/core/db.js';
import { DurableQueue } from '../../src/core/queue.js';
import { createEvent } from '../../src/core/contracts.js';

test('durable queue recovers after worker process kill', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'zalo-crash-'));
  const dbPath = path.join(dir, 'core.db');
  let db: ReturnType<typeof openCoreDatabase> | undefined;
  try {
    db = openCoreDatabase(dbPath);
    const event = createEvent({ platform: 'zalo', account: 'a', conversation: 'c', message: 'm', externalMessageId: 'm', senderId: 'u', direction: 'inbound', type: 'text', text: 'x', occurredAt: new Date().toISOString(), receivedAt: new Date().toISOString(), source: 'platform' });
    db.prepare('INSERT INTO events(event_id,idempotency_key,payload_json,created_at) VALUES (?,?,?,?)').run(event.eventId, event.idempotencyKey, JSON.stringify(event), event.receivedAt);
    const queue = new DurableQueue(db, 50);
    assert.equal(queue.enqueue(event, 'route'), true);
    const worker = spawn(process.execPath, ['-e', `const Database=require('better-sqlite3'); const db=new Database(${JSON.stringify(dbPath)}); db.prepare("UPDATE delivery_queue SET state='processing', leased_until=? WHERE event_id=?").run(new Date(Date.now()+25).toISOString(), ${JSON.stringify(event.eventId)}); setTimeout(() => process.exit(1), 40);`], { stdio: 'ignore' });
    await new Promise<void>((resolve, reject) => { worker.once('exit', code => code === 1 ? resolve() : reject(new Error(`worker exit ${code}`))); worker.once('error', reject); });
    await new Promise(resolve => setTimeout(resolve, 50));
    const reopened = openCoreDatabase(dbPath);
    assert.ok([0, 1].includes(new DurableQueue(reopened, 50).recover()));
    assert.equal((reopened.prepare('SELECT state FROM delivery_queue WHERE event_id=?').get(event.eventId) as { state: string }).state, 'queued');
    reopened.close();
    db.close();
    db = undefined;
  } finally {
    db?.close();
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch { /* Windows may retain SQLite sidecars briefly. */ }
  }
});
