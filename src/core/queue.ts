import type { UnifiedEvent } from './contracts.js';
import type { CoreDatabase } from './db.js';

export interface QueueItem { id: number; eventId: string; routeId: string; state: string; attempts: number; maxAttempts: number; nextRetryAt: string | null; leasedUntil: string | null; lastError: string | null }

export class DurableQueue {
  constructor(private readonly db: CoreDatabase, private readonly leaseMs = 30_000) {}
  enqueue(event: UnifiedEvent, routeId: string): boolean {
    const now = new Date().toISOString();
    const result = this.db.prepare('INSERT OR IGNORE INTO delivery_queue(event_id, route_id, created_at, updated_at) VALUES (?, ?, ?, ?)').run(event.eventId, routeId, now, now);
    return result.changes > 0;
  }
  claimNext(): QueueItem | undefined {
    const now = new Date();
    const iso = now.toISOString();
    const lease = new Date(now.getTime() + this.leaseMs).toISOString();
    const tx = this.db.transaction(() => {
      const row = this.db.prepare("SELECT * FROM delivery_queue WHERE (state='queued' AND (next_retry_at IS NULL OR next_retry_at<=?)) OR (state='processing' AND leased_until<?) ORDER BY CASE WHEN next_retry_at IS NULL THEN 0 ELSE 1 END, next_retry_at, created_at LIMIT 1").get(iso, iso) as QueueItem | undefined;
      if (!row) return undefined;
      this.db.prepare("UPDATE delivery_queue SET state='processing', leased_until=?, attempts=attempts+1, updated_at=? WHERE id=?").run(lease, iso, row.id);
      return { ...row, state: 'processing', leasedUntil: lease, attempts: row.attempts + 1 };
    });
    return tx();
  }
  complete(id: number): void { this.db.prepare("UPDATE delivery_queue SET state='sent', leased_until=NULL, updated_at=? WHERE id=?").run(new Date().toISOString(), id); }
  fail(id: number, error: unknown): void {
    const row = this.db.prepare('SELECT attempts, max_attempts FROM delivery_queue WHERE id=?').get(id) as { attempts: number; max_attempts: number } | undefined;
    if (!row) return;
    const message = error instanceof Error ? error.message : String(error);
    const now = new Date();
    if (row.attempts >= row.max_attempts) this.db.prepare("UPDATE delivery_queue SET state='dead', leased_until=NULL, last_error=?, updated_at=? WHERE id=?").run(message, now.toISOString(), id);
    else { const delay = Math.min(6 * 60 * 60_000, 60_000 * 5 ** Math.max(0, row.attempts - 1)); this.db.prepare("UPDATE delivery_queue SET state='queued', leased_until=NULL, next_retry_at=?, last_error=?, updated_at=? WHERE id=?").run(new Date(now.getTime() + delay).toISOString(), message, now.toISOString(), id); }
  }
  recover(): number { const now = new Date().toISOString(); return this.db.prepare("UPDATE delivery_queue SET state='queued', leased_until=NULL, updated_at=? WHERE state='processing' AND leased_until<?").run(now, now).changes; }
}

export default DurableQueue;