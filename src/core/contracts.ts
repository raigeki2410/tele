import { createHash, randomUUID } from 'node:crypto';

export const PLATFORMS = ['zalo', 'whatsapp', 'weixin', 'wecom', 'tammi', 'telegram'] as const;
export type Platform = typeof PLATFORMS[number];
export type EventDirection = 'inbound' | 'outbound';
export type EventType = 'text' | 'image' | 'video' | 'audio' | 'file' | 'reaction' | 'edit' | 'delete' | 'system';
export type EventSource = 'platform' | 'telegram' | 'dashboard' | 'ai';

export interface CoreId { platform: Platform; account: string; conversation: string; message: string }
export interface UnifiedEvent extends CoreId {
  eventId: string;
  externalMessageId: string;
  senderId: string;
  senderName?: string;
  direction: EventDirection;
  type: EventType;
  text?: string;
  media?: Array<{ kind: string; storageKey: string; mimeType?: string }>;
  replyToExternalId?: string;
  occurredAt: string;
  receivedAt: string;
  source: EventSource;
  isHistorical?: boolean;
  correlationId?: string;
  idempotencyKey: string;
}

export interface PlatformCapabilities { receive: boolean; send: boolean; media: boolean; edit: boolean; delete: boolean; reaction: boolean }
export interface PlatformAdapter {
  readonly platform: Platform;
  start(): Promise<void>;
  stop(): Promise<void>;
  health(): Promise<{ status: 'healthy' | 'degraded' | 'stopped'; detail?: string }>;
  login(accountId: string): Promise<void>;
  logout(accountId: string): Promise<void>;
  send(accountId: string, event: UnifiedEvent): Promise<void>;
  subscribe(listener: (event: UnifiedEvent) => void): () => void;
  capabilities(): PlatformCapabilities;
}

const eventTypes = new Set<EventType>(['text', 'image', 'video', 'audio', 'file', 'reaction', 'edit', 'delete', 'system']);
const sources = new Set<EventSource>(['platform', 'telegram', 'dashboard', 'ai']);
export function idempotencyKey(id: CoreId, type: EventType, externalMessageId = id.message): string {
  return createHash('sha256').update([id.platform, id.account, id.conversation, externalMessageId, type].join('\0')).digest('hex');
}
type EventInput = Omit<UnifiedEvent, 'eventId' | 'idempotencyKey'> & Partial<Pick<UnifiedEvent, 'eventId' | 'idempotencyKey'>>;
export function createEvent(input: EventInput): UnifiedEvent {
  const event: UnifiedEvent = { ...input, eventId: input.eventId ?? randomUUID(), idempotencyKey: input.idempotencyKey ?? idempotencyKey(input, input.type, input.externalMessageId) };
  validateEvent(event);
  return event;
}
export function validateEvent(event: UnifiedEvent): void {
  if (!event.eventId || !event.platform || !event.account || !event.conversation || !event.message || !event.externalMessageId || !event.senderId) throw new Error('UnifiedEvent missing required identity');
  if (!PLATFORMS.includes(event.platform) || !eventTypes.has(event.type) || !sources.has(event.source)) throw new Error('UnifiedEvent contains unsupported enum');
  if (event.direction !== 'inbound' && event.direction !== 'outbound') throw new Error('UnifiedEvent contains unsupported direction');
  if (Number.isNaN(Date.parse(event.occurredAt))) throw new Error('UnifiedEvent invalid occurredAt');
  if (Number.isNaN(Date.parse(event.receivedAt))) throw new Error('UnifiedEvent invalid receivedAt');
}

export interface AccountRecord { platform: Platform; accountId: string; enabled: boolean; createdAt: string }
export interface RouteRecord { routeId: string; platform: Platform; accountId: string; conversationId: string; telegramBotId: string; telegramGroupId: string; threadId: number; owner: string }
export interface DeliveryRecord { eventId: string; routeId: string; state: 'queued' | 'sent' | 'failed'; attempts: number; updatedAt: string; error?: string }
export interface CoreSnapshot { version: 1; accounts: AccountRecord[]; routes: RouteRecord[]; events: UnifiedEvent[]; deliveries: DeliveryRecord[] }
export const emptySnapshot = (): CoreSnapshot => ({ version: 1, accounts: [], routes: [], events: [], deliveries: [] });
export function routeKey(route: Pick<RouteRecord, 'telegramBotId' | 'telegramGroupId' | 'threadId'>): string { return `${route.telegramBotId}:${route.telegramGroupId}:${route.threadId}`; }
export function conversationKey(value: Pick<RouteRecord, 'platform' | 'accountId' | 'conversationId'>): string { return `${value.platform}:${value.accountId}:${value.conversationId}`; }
export function eventKey(event: Pick<UnifiedEvent, 'platform' | 'account' | 'conversation' | 'externalMessageId'>): string { return `${event.platform}:${event.account}:${event.conversation}:${event.externalMessageId}`; }

export class AdapterRegistry {
  private readonly adapters = new Map<Platform, PlatformAdapter>();
  register(adapter: PlatformAdapter): void { if (this.adapters.has(adapter.platform)) throw new Error(`Adapter already registered: ${adapter.platform}`); this.adapters.set(adapter.platform, adapter); }
  get(platform: Platform): PlatformAdapter { const adapter = this.adapters.get(platform); if (!adapter) throw new Error(`Adapter unavailable: ${platform}`); return adapter; }
  list(): Platform[] { return [...this.adapters.keys()]; }
}
