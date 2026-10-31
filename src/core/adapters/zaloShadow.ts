import { createEvent, type PlatformAdapter, type PlatformCapabilities, type UnifiedEvent, type EventType } from '../contracts.js';
import { subscribeZalo, type ZaloRawMessage } from '../../zalo/handler.js';

type TestZaloSource = { subscribe(listener: (msg: ZaloRawMessage) => void): () => void };

export class ZaloShadowAdapter implements PlatformAdapter {
  readonly platform = 'zalo' as const;
  private running = false;
  private listeners = new Set<(event: UnifiedEvent) => void>();
  private unsubscribeSource: (() => void) | undefined;
  constructor(private readonly accountId = 'legacy-zalo', private readonly testSource?: TestZaloSource) {}
  start(): Promise<void> {
    this.running = true;
    const source = this.testSource ?? { subscribe: subscribeZalo };
    this.unsubscribeSource = source.subscribe(raw => {
      if (!this.running) return;
      const now = new Date().toISOString();
      const msg = raw.data;
      const msgId = msg.msgId ?? msg.realMsgId ?? msg.cliMsgId ?? `zalo-${Date.now()}`;
      const conversationId = raw.threadId;
      const senderId = msg.uidFrom ?? 'unknown';
      const senderName = msg.dName;
      const text = typeof msg.content === 'string' ? msg.content : undefined;
      const occurredAt = msg.ts ? new Date(Number(msg.ts) * 1000).toISOString() : now;
      const msgTypeStr = msg.msgType ?? 'webchat';
      const typeMap: Record<string, EventType> = {
        'webchat': 'text', 'chat.photo': 'image', 'chat.video.msg': 'video', 'chat.voice': 'audio',
        'share.file': 'file', 'chat.gif': 'image', 'chat.sticker': 'image',
        'chat.location.new': 'file', 'group.poll': 'text', 'chat.forward': 'file', 'chat.ecard': 'file'
      };
      const eventType = typeMap[msgTypeStr] ?? 'text';
      const event = createEvent({
        platform: 'zalo', account: this.accountId, conversation: conversationId, message: msgId,
        externalMessageId: msgId, senderId, senderName, direction: 'inbound',
        type: eventType, text, occurredAt, receivedAt: now, source: 'platform'
      });
      for (const target of this.listeners) target(event);
    });
    return Promise.resolve();
  }
  stop(): Promise<void> { this.running = false; this.listeners.clear(); this.unsubscribeSource?.(); this.unsubscribeSource = undefined; return Promise.resolve(); }
  health(): Promise<{ status: 'healthy' | 'degraded' | 'stopped' }> { return Promise.resolve({ status: this.running ? 'healthy' : 'stopped' }); }
  login(_accountId: string): Promise<void> { return Promise.resolve(); }
  logout(_accountId: string): Promise<void> { return Promise.resolve(); }
  send(_accountId: string, _event: UnifiedEvent): Promise<void> { return Promise.reject(new Error('Zalo shadow adapter is receive-only')); }
  subscribe(listener: (event: UnifiedEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  capabilities(): PlatformCapabilities { return { receive: true, send: false, media: true, edit: true, delete: true, reaction: true }; }
}

export default ZaloShadowAdapter;