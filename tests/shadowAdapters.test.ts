import test from 'node:test';
import assert from 'node:assert/strict';
import { ZaloShadowAdapter } from '../src/core/adapters/zaloShadow.js';
import { TammiShadowAdapter } from '../src/core/adapters/tammiShadow.js';
import type { ZaloRawMessage } from '../src/zalo/handler.js';
import type { TammiRawEvent } from '../src/tammi/bridge.js';

test('shadow adapters normalize inbound messages and never send', async () => {
  let pushZalo: ((value: ZaloRawMessage) => void) | undefined;
  const zalo = new ZaloShadowAdapter('legacy-zalo', { subscribe(listener) { pushZalo = listener; return () => { pushZalo = undefined; }; } });
  const zaloEvents: unknown[] = []; zalo.subscribe(event => zaloEvents.push(event)); await zalo.start();
  pushZalo?.({ type: 1, data: { content: 'hello', msgId: 'z1', uidFrom: 'u1', dName: 'User', ts: String(Date.now()), msgType: 'webchat', idTo: 'c1' }, isSelf: false, threadId: 'c1' });
  assert.equal((zaloEvents[0] as { platform: string }).platform, 'zalo');
  await assert.rejects(() => zalo.send('legacy-zalo', zaloEvents[0] as never), /receive-only/);

  let pushTammi: ((value: TammiRawEvent) => void) | undefined;
  const tammi = new TammiShadowAdapter('legacy-tammi', { subscribe(listener) { pushTammi = listener; return () => { pushTammi = undefined; }; } });
  const tammiEvents: unknown[] = []; tammi.subscribe(event => tammiEvents.push(event)); await tammi.start();
  pushTammi?.({ conversationId: 'c1', senderId: 'u1', senderName: 'User', text: 'hello', messageId: 't1', timestamp: Date.now() });
  assert.equal((tammiEvents[0] as { platform: string }).platform, 'tammi');
});