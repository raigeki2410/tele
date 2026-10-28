// MUST stay first: fixes Telegraf's multipart stream for Node >= 26 uploads.
import './utils/multipartStreamPatch.js';
import { getZaloApi, resetZaloApi } from './zalo/client.js';
import { CloseReason, ThreadType } from 'zca-js';
import { setupZaloHandler } from './zalo/handler.js';
import { tgBot, syncTelegramCommands } from './telegram/bot.js';
import { setupTelegramHandler } from './telegram/handler.js';
import { config } from './config.js';
import { startUpdateChecker } from './updater.js';
import { store, userCache } from './store.js';
import { registerShutdownHandler, requestShutdown } from './lifecycle.js';
import { terminal } from './utils/terminal.js';
import { startTammi, stopTammi, tammiBot } from './tammi/bridge.js';
import { setupTammiTelegram } from './tammi/telegram.js';

// ── Global safety net — prevent unhandled rejections from crashing ────────────
process.on('unhandledRejection', (reason) => {
  console.error('[Boot] Unhandled rejection (ignored):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[Boot] Uncaught exception:', err);
  void requestShutdown('Uncaught exception', 43);
});

// ── Module-level ref to Telegram handler's API setter (used by reconnect) ──────
let _setZaloApi: ((api: Awaited<ReturnType<typeof getZaloApi>>) => void) | null = null;
let _reconnectInProgress = false;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _activeZaloApi: Awaited<ReturnType<typeof getZaloApi>> | null = null;
let _bridgeReadyAnnounced = false;
let _watchdogTimer: ReturnType<typeof setInterval> | null = null;
let _lastCloseCode: number | null = null;

// ── Zalo listener watchdog ───────────────────────────────────────────────────
// zca-js only emits 'disconnected' when the WebSocket closes at the JS level. A
// socket killed underneath the process (PC sleep/resume, NIC change, NAT
// timeout) can leave the object believing it is still OPEN: Telegram→Zalo keeps
// working while Zalo→Telegram is silently dead, with nothing in the log.
//
// A WebSocket-level ping/pong probe does NOT work here — Zalo's server does not
// answer control frames (verified: every probe timed out on a healthy socket).
// Instead we enable TCP keepalive on the underlying socket, so the OS itself
// probes the peer and surfaces a dead connection as a socket error, which
// zca-js turns into the 'disconnected' event we already handle.
const KEEPALIVE_DELAY_MS = 30_000;
const WATCHDOG_INTERVAL_MS = 60_000;

interface WsLike {
  readyState?: number;
  _socket?: { setKeepAlive?: (enable: boolean, delay?: number) => void };
}

function listenerWs(api: unknown): WsLike | undefined {
  return (api as { listener?: { ws?: WsLike } } | null)?.listener?.ws;
}

/** Let the OS detect a dead peer even when zca-js sees the socket as OPEN. */
function enableSocketKeepAlive(api: unknown): void {
  try {
    listenerWs(api)?._socket?.setKeepAlive?.(true, KEEPALIVE_DELAY_MS);
  } catch { /* best effort */ }
}

/**
 * Fallback for a socket that is definitively CLOSING/CLOSED while the
 * 'disconnected' event never arrived (so the reconnect handler never ran). The
 * half-open case — where the socket still reads as OPEN — is covered by TCP
 * keepalive above.
 */
function runZaloWatchdog(): void {
  const api = _activeZaloApi;
  if (!api) return;
  if (_reconnectTimer || _reconnectInProgress) return;
  // Duplicate/kicked sessions need a manual /login — don't fight the server.
  if (_lastCloseCode === CloseReason.DuplicateConnection || _lastCloseCode === CloseReason.KickConnection) return;

  const ws = listenerWs(api);
  // OPEN (1) may be a healthy socket or a half-open one keepalive has yet to
  // surface; CONNECTING (0) still deserves time. Only act on a closed socket.
  if (!ws || ws.readyState === 1 || ws.readyState === 0) return;

  console.warn('[Boot] Zalo listener socket is closed but no close event arrived — forcing reconnect');
  scheduleReconnect(0);
}

function startZaloWatchdog(): void {
  if (_watchdogTimer) return;
  _watchdogTimer = setInterval(runZaloWatchdog, WATCHDOG_INTERVAL_MS);
}

// ── Boot Zalo (also used when /login swaps in a fresh API) ───────────────────

async function pruneLeftGroupTopics(api: Awaited<ReturnType<typeof getZaloApi>>): Promise<void> {
  try {
    const groups = await api.getAllGroups() as { gridVerMap?: Record<string, string> } | undefined;
    const activeGroupIds = new Set(Object.keys(groups?.gridVerMap ?? {}));
    const removed: string[] = [];
    for (const entry of store.all()) {
      if (entry.type === 1 && !activeGroupIds.has(entry.zaloId)) {
        store.remove(entry.topicId);
        removed.push(`${entry.name} (${entry.zaloId})`);
      }
    }
    if (removed.length > 0) {
      terminal.status('topics', `pruned ${removed.length} stale mapping(s)`, 'warn');
    }
  } catch (err) {
    console.warn('[Boot] Could not prune stale group topics:', err);
  }
}

async function startZalo(
  api: Awaited<ReturnType<typeof getZaloApi>>,
  isReconnect = false,
): Promise<void> {
  _activeZaloApi = api;
  if (!isReconnect) void pruneLeftGroupTopics(api);
  await setupZaloHandler(api);
  if (isReconnect) {
    api.listener.once('connected', () => {
      try {
        // Recover recent gap after disconnect (messages + reactions in both DM/group).
        api.listener.requestOldMessages(ThreadType.User);
        api.listener.requestOldMessages(ThreadType.Group);
        api.listener.requestOldReactions(ThreadType.User);
        api.listener.requestOldReactions(ThreadType.Group);
        terminal.status('sync', 'catch-up requested after reconnect', 'info');
      } catch (err) {
        console.warn('[Boot] Failed to request catch-up sync:', err);
      }
    });
  }
  api.listener.start();
  // Enable TCP keepalive on the fresh socket (and any later replacement) so the
  // OS can surface a silently-dead connection as a 'disconnected' event.
  enableSocketKeepAlive(api);
  api.listener.on('connected', () => enableSocketKeepAlive(api));
  terminal.status('zalo', `listener ${isReconnect ? 're' : ''}started`, 'success');
  if (!_bridgeReadyAnnounced) {
    _bridgeReadyAnnounced = true;
    terminal.status('bridge', 'ready · forwarding active', 'success');
    terminal.section('LIVE ACTIVITY');
  }

  _lastCloseCode = null;

  // Auto-reconnect only on closings that are safe to recover automatically.
  // NOTE: `on` (not `once`) — a `.once` listener is consumed by the first close,
  // so a later drop is never seen and the bridge keeps accepting Telegram→Zalo
  // sends while Zalo→Telegram is silently dead.
  api.listener.on('disconnected', (code: CloseReason, reason: string) => {
    _lastCloseCode = code;
    if (code === CloseReason.ManualClosure) return;
    if (code === CloseReason.DuplicateConnection) {
      console.warn(`[Boot] Zalo disconnected: duplicate connection (code=${code}, reason=${reason})`);
      tgBot.telegram.sendMessage(
        config.telegram.groupId,
        '⚠️ Zalo bị ngắt do đăng nhập trùng phiên (duplicate connection). Đóng phiên Zalo Web/PC khác rồi dùng <b>/login</b> nếu cần.',
        { parse_mode: 'HTML' },
      ).catch(() => undefined);
      return;
    }
    if (code === CloseReason.KickConnection) {
      console.warn(`[Boot] Zalo disconnected: kicked connection (code=${code}, reason=${reason})`);
      tgBot.telegram.sendMessage(
        config.telegram.groupId,
        '⚠️ Zalo đã ngắt phiên bridge (kick connection). Vui lòng đăng nhập lại bằng <b>/login</b>.',
        { parse_mode: 'HTML' },
      ).catch(() => undefined);
      return;
    }
    console.warn(`[Boot] Zalo disconnected (code=${code}, reason=${reason}), reconnecting in 5 s…`);
    tgBot.telegram.sendMessage(
      config.telegram.groupId,
      '⚠️ Zalo bị ngắt kết nối, đang thử kết nối lại…',
    ).catch(() => undefined);
    scheduleReconnect(5_000);
  });

  // A close without a matching 'disconnected' (socket torn down while the
  // process was suspended) would otherwise be invisible — log it explicitly.
  api.listener.on('closed', (code: number, reason: string) => {
    console.warn(`[Boot] Zalo listener closed (code=${code}, reason=${reason})`);
  });
  api.listener.on('error', (err: unknown) => {
    console.warn('[Boot] Zalo listener error:', err);
  });

  startZaloWatchdog();
}

/**
 * Tear the dead session down and build a fresh one. Shared by the 'disconnected'
 * event and the watchdog, so a socket that dies without emitting anything still
 * recovers.
 */
function scheduleReconnect(delayMs: number): void {
  if (_reconnectTimer || _reconnectInProgress) return;
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null;
    void (async () => {
      if (_reconnectInProgress) return;
      _reconnectInProgress = true;
      try {
        // Stop the old listener first so its half-open socket is not leaked.
        try { _activeZaloApi?.listener.stop(); } catch { /* already gone */ }
        resetZaloApi();
        const newApi = await getZaloApi();
        _setZaloApi?.(newApi);
        await startZalo(newApi, true);
        tgBot.telegram.sendMessage(config.telegram.groupId, '✅ Zalo đã kết nối lại và đang đồng bộ lại tin gần đây.').catch(() => undefined);
        terminal.status('zalo', 'reconnected and syncing', 'success');
      } catch (err) {
        console.error('[Boot] Zalo reconnect failed:', err);
        tgBot.telegram.sendMessage(
          config.telegram.groupId,
          '⚠️ Kết nối lại Zalo thất bại. Hãy dùng <b>/login</b> để đăng nhập lại.',
          { parse_mode: 'HTML' },
        ).catch(() => undefined);
      } finally {
        _reconnectInProgress = false;
      }
    })();
  }, delayMs);
}

async function main(): Promise<void> {
  await terminal.intro('1.0.0');
  terminal.installConsoleTheme();
  terminal.section('STARTUP');
  terminal.status('runtime', `${process.version} · pid ${process.pid}`, 'muted');
  terminal.status('cache', `${userCache.stats().users} users · ${store.all().length} topics restored`, 'muted');

  // ── Auto update checker — must register BEFORE setupTelegramHandler ─────────
  // bot.action() is middleware; the catch-all on('callback_query') in handler.ts
  // doesn't call next(), so ua: callbacks must be registered first in the chain.
  startUpdateChecker(tgBot);

  setupTammiTelegram();

  // ── Wire up Telegram handler BEFORE launching the bot ─────────────────────
  // setupTelegramHandler returns a setter to inject the Zalo API after auto-login.
  const setZaloApi = setupTelegramHandler(null, async (newApi) => {
    await startZalo(newApi, true);
  });
  _setZaloApi = setZaloApi;

  // ── Register bot commands for Telegram menu ───────────────────────────────
  tgBot.telegram.setMyCommands([
    { command: 'login',          description: 'Đăng nhập Zalo qua QR code' },
    { command: 'loginweb',       description: 'Đăng nhập Zalo QR (giống /login)' },
    { command: 'loginapp',       description: 'Đăng nhập Zalo qua PC App API' },
    { command: 'search',         description: 'Tìm bạn bè / nhóm Zalo để tạo topic' },
    { command: 'group_info',     description: 'Xem thông tin & thành viên nhóm Zalo hiện tại' },
    { command: 'group_infoall',  description: 'Xem toàn bộ thành viên nhóm Zalo hiện tại' },
    { command: 'addfriend',      description: 'Tìm & kết bạn Zalo theo số điện thoại' },
    { command: 'addgroup',       description: 'Tạo topic cho nhóm Zalo chưa có topic' },
    { command: 'joingroup',      description: 'Tham gia nhóm Zalo qua link' },
    { command: 'leavegroup',     description: 'Rời nhóm Zalo & đóng topic (dùng trong topic nhóm)' },
    { command: 'friendrequests', description: 'Xem lời mời kết bạn & lời mời nhóm' },
    { command: 'topic',          description: 'Quản lý topic: list / info / delete' },
    { command: 'history',        description: 'Nạp lịch sử chat nhóm vào topic (dùng trong topic nhóm)' },
    { command: 'autoreply',      description: 'Tự trả lời DM khi offline: on / off / status' },
    { command: 'spoiler',        description: 'Che mờ ảnh/video Zalo→Telegram: on / off / status' },
    { command: 'recall',         description: 'Thu hồi tin nhắn (reply vào tin đã gửi)' },
    { command: 'admin',          description: 'Admin panel: trạng thái, cache, tra mapping' },
    { command: 'status',         description: 'Xem trạng thái bridge: uptime, số topic, Zalo' },
    { command: 'restart',        description: 'Khởi động lại bridge (chỉ admin)' },
    { command: 'setup',          description: 'Cấu hình biến env qua wizard (chỉ admin)' },
    { command: 'update',         description: 'Kiểm tra bản cập nhật mới' },
  ]).catch(() => undefined);

  // ── Graceful shutdown/restart shared by signals, commands and polling ──────
  registerShutdownHandler(async (reason, exitCode) => {
    stopTammi();
    try { tammiBot?.stop(reason); } catch { /* bot may not have launched */ }
    // Animate while listeners stop and debounced stores flush, so shutdown is
    // both visually smooth and operationally useful rather than a fixed delay.
    const outro = terminal.shutdown(`${reason} · exit ${exitCode}`);
    if (_reconnectTimer) {
      clearTimeout(_reconnectTimer);
      _reconnectTimer = null;
    }
    if (_watchdogTimer) {
      clearInterval(_watchdogTimer);
      _watchdogTimer = null;
    }
    try { _activeZaloApi?.listener.stop(); } catch { /* ignore */ }
    try { await tgBot.stop(reason); } catch { /* bot may not have launched yet */ }
    // Let debounced msg/user-cache persistence finish before process exit.
    await new Promise(r => setTimeout(r, 2500));
    await outro;
    process.exit(exitCode);
  });

  // ── Start Telegram bot so /login can be received immediately ───────────────
  // NOTE: tgBot.launch() runs the polling loop forever, so we must NOT await it.
  // The second argument callback fires once getMe() + deleteWebhook() succeed.
  void tgBot.launch({ allowedUpdates: ['message', 'callback_query', 'message_reaction', 'poll_answer', 'poll'] }, () => {
    terminal.status('telegram', 'polling connected', 'success');

    syncTelegramCommands()
      .then(() => terminal.status('commands', 'menu synchronized', 'success'))
      .catch((err: unknown) => console.warn('[Boot] Failed to sync Telegram commands:', err));

    // ── Attempt Zalo login in background ────────────────────────────────────
    // If credentials.json exists → connects automatically and updates currentApi.
    // If not → notifies the user to run /login.
    getZaloApi()
      .then(async (api) => {
        setZaloApi(api);   // ← inject into Telegram handler so TG→Zalo works
        await startZalo(api);
      })
      .catch((err: unknown) => {
        console.warn('[Boot] Zalo auto-login failed:', err);
        tgBot.telegram
          .sendMessage(
            config.telegram.groupId,
            '⚠️ Chưa đăng nhập Zalo. Gửi <b>/login</b> để đăng nhập.',
            { parse_mode: 'HTML' },
          )
          .catch(() => undefined);
      });
  }).catch((err: unknown) => {
    console.error('[Boot] Telegram polling stopped:', err);
    // Do not leave a half-alive Zalo-only bridge. A supervisor/run.sh can
    // restart exit code 43; a direct npm start exits visibly instead of lying.
    void requestShutdown('Telegram polling failure', 43);
  });

  if (tammiBot && config.tammi.url) {
    void tammiBot.launch({ allowedUpdates: ['message'] }, () => {
      terminal.status('tammi', 'Telegram polling connected', 'success');
      startTammi();
    }).catch((err: unknown) => console.error('[Tammi] Telegram polling stopped:', err));
  }

  terminal.status('bridge', 'starting services…', 'info');

  process.once('SIGINT',  () => { void requestShutdown('Received SIGINT', 0); });
  process.once('SIGTERM', () => { void requestShutdown('Received SIGTERM', 0); });
}

main().catch((err: unknown) => {
  console.error('[Boot] Fatal error:', err);
  process.exit(1);
});
