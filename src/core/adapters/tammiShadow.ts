import { createEvent, type PlatformAdapter, type PlatformCapabilities, type UnifiedEvent } from '../contracts.js';
import { subscribeTammi, type TammiRawEvent } from '../../tammi/bridge.js';

type TestTammiSource = { subscribe(listener: (evt: TammiRawEvent) => void): () => void };

export class TammiShadowAdapter implements PlatformAdapter {
  readonly platform = 'tammi' as const;
  private running = false;
  private listeners = new Set<(event: UnifiedEvent) => void>();
  private unsubscribeSource: (() => void) | undefined;
  constructor(private readonly accountId = 'legacy-tammi', private readonly testSource?: TestTammiSource) {}
  start(): Promise<void> {
    this.running = true;
    const source = this.testSource ?? { subscribe: subscribeTammi };
    this.unsubscribeSource = source.subscribe(raw => {
      if (!this.running) return;
      const now = new Date().toISOString();
      const conversationId = String(raw.conversationId ?? '');
      if (!conversationId) return;
      const senderId = String(raw.senderId ?? 'unknown');
      const senderName = raw.senderName ? String(raw.senderName) : undefined;
      const text = raw.text ? String(raw.text) : undefined;
      if (!text) return;
      const msgId = String(raw.messageId ?? raw.id ?? `tammi-${Date.now()}`);
      const occurredAt = raw.timestamp ? new Date(Number(raw.timestamp)).toISOString() : now;
      const event = createEvent({
        platform: 'tammi', account: this.accountId, conversation: conversationId, message: msgId,
        externalMessageId: msgId, senderId, senderName, direction: 'inbound',
        type: 'text', text, occurredAt, receivedAt: now, source: 'platform'
      });
      for (const target of this.listeners) target(event);
    });
    return Promise.resolve();
  }
  stop(): Promise<void> { this.running = false; this.listeners.clear(); this.unsubscribeSource?.(); this.unsubscribeSource = undefined; return Promise.resolve(); }
  health(): Promise<{ status: 'healthy' | 'degraded' | 'stopped' }> { return Promise.resolve({ status: this.running ? 'healthy' : 'stopped' }); }
  login(_accountId: string): Promise<void> { return Promise.resolve(); }
  logout(_accountId: string): Promise<void> { return Promise.resolve(); }
  send(_accountId: string, _event: UnifiedEvent): Promise<void> { return Promise.reject(new Error('Tammi shadow adapter is receive-only')); }
  subscribe(listener: (event: UnifiedEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  capabilities(): PlatformCapabilities { return { receive: true, send: false, media: false, edit: false, delete: false, reaction: false }; }
}

export default TammiShadowAdapter;