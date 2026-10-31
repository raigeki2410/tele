import { createEvent, type PlatformAdapter, type RouteRecord, type UnifiedEvent } from './contracts.js';
import { CorePersistence } from './persistence.js';

type Sender = (route: RouteRecord, event: UnifiedEvent) => Promise<void>;
export class CoreRouter {
  private readonly adapters = new Map<string, PlatformAdapter>();
  private readonly seen = new Set<string>();
  private readonly sending = new Set<string>();
  constructor(private readonly persistence: CorePersistence, private readonly sendTelegram: Sender) {}
  register(accountId: string, adapter: PlatformAdapter): void { this.adapters.set(`${adapter.platform}:${accountId}`, adapter); adapter.subscribe(event => { void this.ingest(event); }); }
  async ingest(event: UnifiedEvent): Promise<boolean> {
    if (this.seen.has(event.idempotencyKey) || !this.persistence.appendEvent(event)) return false;
    this.seen.add(event.idempotencyKey);
    const route = this.persistence.data.routes.find(x => x.platform === event.platform && x.accountId === event.account && x.conversationId === event.conversation);
    if (!route || event.source === 'telegram' || event.source === 'ai' || event.direction === 'outbound') return true;
    const loopKey = `${route.routeId}:${event.externalMessageId}`;
    if (this.sending.has(loopKey)) return true;
    this.sending.add(loopKey);
    const delivery = { eventId: event.eventId, routeId: route.routeId, state: 'queued' as const, attempts: 0, updatedAt: new Date().toISOString() };
    this.persistence.upsertDelivery(delivery);
    try { await this.sendTelegram(route, event); this.persistence.upsertDelivery({ ...delivery, state: 'sent', attempts: 1, updatedAt: new Date().toISOString() }); }
    catch (error) { this.persistence.upsertDelivery({ ...delivery, state: 'failed', attempts: 1, updatedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }); throw error; }
    finally { this.sending.delete(loopKey); }
    return true;
  }
  async send(accountId: string, event: UnifiedEvent): Promise<void> {
    const adapter = this.adapters.get(`${event.platform}:${accountId}`); if (!adapter) throw new Error(`Adapter unavailable: ${event.platform}:${accountId}`);
    await adapter.send(accountId, createEvent({ ...event, direction: 'outbound', source: 'telegram' }));
  }
}
