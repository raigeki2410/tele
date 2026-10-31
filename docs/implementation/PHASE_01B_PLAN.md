# Phase 1B Implementation Plan

**Date:** 28/10/2026
**Status:** IMPLEMENTED; see `PHASE_01B_TEST_REPORT.md` and `PHASE_01B_HANDOFF.md`
**Baseline:** Phase 1A core contracts, router, JSON persistence, 4/4 core tests PASS, TypeScript build PASS, full regression FAIL (config.test.ts, mediaSpoiler.test.ts), no SQLite driver installed, no staging gateway.

---

## 1. Objectives

1. Replace in-memory/JSON CorePersistence with **SQLite (WAL mode)** as source of truth.
2. Implement **durable delivery queue** with idempotent enqueue, lease-based claim, exponential backoff retry, dead-letter.
3. **Fix regression tests** for Windows portability and isolation.
4. Add **shadow adapters** for Zalo/Tammi that normalize into Core without sending duplicate Telegram messages.
5. Create **isolated staging gateway** with separate token/group/db/runtime.
6. Produce test evidence, handoff, and status documents.

**Non-goals:** production migration, traffic switch, PostgreSQL/Redis, WhatsApp/Weixin adapters, dashboard, AI worker.

---

## 2. Current State Inspection

### Core 1A Files
- `src/core/contracts.ts` — PlatformAdapter, UnifiedEvent, CoreId, idempotencyKey, AdapterRegistry, validation.
- `src/core/persistence.ts` — CorePersistence (JSON atomic snapshot), dryRunLegacyMigration, backup/restore.
- `src/core/router.ts` — CoreRouter (in-memory dedupe, echo suppression, delivery upsert via persistence).
- `src/core/index.ts` — public exports.
- `tests/core.test.ts` — 4 passing tests (identity, dedupe, migration conflict, rollback).

### Regression Failures
- `tests/config.test.ts` — spawns subprocess with cleaned env; failures on Windows due to `NODE_OPTIONS`/path handling and cross-test env leakage.
- `tests/mediaSpoiler.test.ts` — uses `os.tmpdir()` unique dirs but `spawnSync` subprocesses don't inherit `DATA_DIR` reliably; file not found on read.

### Test Runner
- `package.json` scripts use POSIX `NODE_OPTIONS=...` which fails in PowerShell/CMD.
- No `cross-env` or Windows-compatible wrapper.
- Tests run in parallel by default causing shared mutable state collisions (`process.env`, singleton caches).

### Dependencies
- No SQLite driver installed (`better-sqlite3`, `sqlite3`, `node:sqlite` all absent).
- Node 26.5.0 (>=20.11 satisfied).
- Native addon toolchain likely present (`@napi-rs/canvas` compiles).

### Docs
- `docs/tele_phase1_handoff.md`, `docs/tele_phase1_plan.md` exist.
- No `docs/implementation/` directory yet.

---

## 3. SQLite Persistence Design

### Driver Selection
- **Primary:** `better-sqlite3` (synchronous, fast, WAL support, native addon).
- **Fallback:** if native build fails in CI, use `sql.js` (WASM) or `@sqlite.org/sqlite-wasm` — but prefer native for performance and simplicity.
- **Decision point:** attempt `npm i better-sqlite3`; if `npm run build` passes, commit. If not, evaluate `sqlite3` (async, also native) or WASM.

### Schema (SQLite, version 1)

```sql
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

CREATE TABLE schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE accounts (
  platform TEXT NOT NULL,
  account_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  config_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (platform, account_id)
);

CREATE TABLE conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  account_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (platform, account_id, external_id)
);

CREATE TABLE telegram_routes (
  bot_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  thread_id INTEGER NOT NULL,
  platform TEXT NOT NULL,
  account_id TEXT NOT NULL,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE RESTRICT,
  owner TEXT NOT NULL DEFAULT 'core',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (bot_id, group_id, thread_id),
  UNIQUE (platform, account_id, conversation_id)
);

CREATE TABLE unified_events (
  event_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE delivery_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES unified_events(event_id) ON DELETE CASCADE,
  route_bot_id TEXT NOT NULL,
  route_group_id TEXT NOT NULL,
  route_thread_id INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_retry_at TEXT,
  last_error TEXT,
  leased_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_delivery_claim ON delivery_queue(state, next_retry_at) WHERE state IN ('queued','processing');
CREATE INDEX idx_delivery_event ON delivery_queue(event_id);

CREATE TABLE msg_map (
  internal_id TEXT PRIMARY KEY,
  platform_msg_id TEXT NOT NULL,
  telegram_msg_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Migration Strategy
1. On first init, create tables and insert `schema_version` = 1.
2. Keep `CorePersistence` (JSON) as **export/backup/migration tool** — `backup()` writes full snapshot to JSON; `restore()` loads from JSON into SQLite (idempotent upsert).
3. Dry-run migration from `topics.json` / `tammi-topics.json` uses same logic as 1A but writes into SQLite `telegram_routes` with conflict detection.

### API Compatibility
- New class `SqliteCorePersistence` implementing same public surface as `CorePersistence`:
  - `addAccount`, `addRoute`, `appendEvent`, `upsertDelivery`, `backup`, `restore`, `data` (snapshot for read-only compatibility).
- `CoreRouter` unchanged — consumes persistence via same interface.
- Legacy JSON file stays at `data/core-snapshot.json` for backward compatibility.

---

## 4. Durable Queue Design

### Enqueue (idempotent)
```ts
async function enqueueDelivery(event: UnifiedEvent, route: RouteRecord): Promise<void> {
  const idempotencyKey = event.idempotencyKey;
  db.prepare(`INSERT OR IGNORE INTO unified_events (event_id, idempotency_key, payload_json)
              VALUES (?, ?, ?)`).run(event.eventId, idempotencyKey, JSON.stringify(event));
  db.prepare(`INSERT OR IGNORE INTO delivery_queue (event_id, route_bot_id, route_group_id, route_thread_id, state)
              VALUES (?, ?, ?, ?, 'queued')`).run(event.eventId, route.botId, route.groupId, route.threadId);
}
```

### Claim (atomic lease)
```sql
UPDATE delivery_queue
SET state = 'processing',
    leased_until = datetime('now', '+30 seconds'),
    attempts = attempts + 1,
    updated_at = datetime('now')
WHERE id = (
  SELECT id FROM delivery_queue
  WHERE state = 'queued'
     OR (state = 'processing' AND leased_until < datetime('now'))
  ORDER BY next_retry_at IS NULL DESC, next_retry_at ASC, created_at ASC
  LIMIT 1
)
RETURNING *;
```

### Retry / Backoff
- On failure: `next_retry_at = datetime('now', '+' || CASE attempts WHEN 1 THEN '1 minute' WHEN 2 THEN '5 minutes' WHEN 3 THEN '15 minutes' WHEN 4 THEN '1 hour' ELSE '6 hours' END)`, `state = 'queued'`, `leased_until = NULL`.
- After `max_attempts` → `state = 'dead'`, log to `audit_log`.

### Recovery on Startup
```sql
UPDATE delivery_queue
SET state = 'queued', leased_until = NULL, next_retry_at = NULL
WHERE state = 'processing' AND leased_until < datetime('now');
```

### Processing Loop (worker)
- Single writer per process (SQLite limitation).
- Poll `claimNext()` every 500ms when idle.
- Execute `sendTelegram(route, event)`.
- On success → `state = 'sent'`.
- On transient error → retry logic above.
- On permanent error → `state = 'failed'` (or dead after retries).

### At-least-once Semantics
- Idempotency key + `unified_events` unique constraint prevents duplicate processing.
- External dedupe via `msg_map` (Telegram message ID per platform message) reduces duplicate sends.
- **Not exactly-once** — network partitions can cause redelivery; downstream must be idempotent.

---

## 5. Regression Test Fixes

### `npm test` Script (Windows-compatible)
```json
"test": "node --disable-warning=DEP0205 --import tsx --test tests/*.test.ts",
"test:core": "node --disable-warning=DEP0205 --import tsx --test tests/core.test.ts",
"check": "npm run build && npm run test"
```
- Removes POSIX `NODE_OPTIONS=`.
- Uses Node 20+ `--import` flag directly.

### Test Isolation
- Each test file creates **unique temp `DATA_DIR`** via `os.tmpdir()` + pid + timestamp.
- `config.test.ts`: already spawns isolated subprocess — keep; ensure `cwd` and `env` are clean.
- `mediaSpoiler.test.ts`: ensure spawned subprocess receives `DATA_DIR` in `env` (currently missing in `run()`).
- Add `test.beforeEach` / `test.afterEach` where needed to reset singleton modules (`mediaSpoiler`, `config` caches) — or rely on subprocess isolation.

### Shared Mutable State
- `src/utils/mediaSpoiler.ts` loads once at import. Tests that spawn subprocess avoid this; inline tests must reset.
- `src/config.ts` reads `process.env` at import time. Subprocess isolation works; inline tests need fresh import via dynamic `import()` with cleared cache or subprocess.

---

## 6. Shadow Adapter Wrappers

### Zalo Shadow Adapter (`src/core/adapters/zaloShadow.ts`)
- Implements `PlatformAdapter` (platform: 'zalo').
- `start()`: attaches to existing Zalo listener events (via `getZaloApi().listener.on('message', ...)`).
- `subscribe(listener)`: normalizes Zalo message → `UnifiedEvent` (platform='zalo', account='legacy-zalo', conversation=`${type}:${zaloId}`, message=msgId, externalMessageId=msgId, ...), calls `listener(event)`.
- `send()`: **no-op / throws** — legacy outbound path remains in `src/telegram/handler.ts`.
- `capabilities()`: `{ receive: true, send: false, media: true, edit: true, delete: true, reaction: true }`.
- Does **not** call `tgBot.telegram.sendMessage` — only persists via CoreRouter.

### Tammi Shadow Adapter (`src/core/adapters/tammiShadow.ts`)
- Similar: wraps `src/tammi/bridge.ts` SSE `receive()` path.
- Normalizes Tammi event → `UnifiedEvent` (platform='tammi', account='legacy-tammi', conversation=conversationId).
- `send()`: no-op.

### Integration
- In **staging only**: instantiate `SqliteCorePersistence`, `CoreRouter`, register shadow adapters, start them.
- Legacy `src/index.ts` unchanged — production continues using JSON stores and direct Telegram handlers.

---

## 7. Isolated Staging Gateway

### Configuration
- `.env.staging` with:
  - `TG_TOKEN=<staging_bot_token>`
  - `TG_GROUP_ID=<staging_supergroup_id>`
  - `DATA_DIR=./data-staging`
  - `CORE_DB=./data-staging/core.db`
  - `NODE_ENV=staging`
- `src/core/stagingGateway.ts` — entry point:
  - Guards: `if (process.env.NODE_ENV !== 'staging') throw new Error('Staging gateway only runs in NODE_ENV=staging');`
  - Initializes SQLite persistence, CoreRouter, shadow adapters, Telegram bot (separate Telegraf instance).
  - Registers `/core-status` command for health.
  - **Never** touches production `data/`, `credentials.json`, or main bot token.

### Startup Script
```json
"dev:staging": "NODE_ENV=staging dotenv -e .env.staging -- node --disable-warning=DEP0205 --import tsx src/core/stagingGateway.ts"
```
(Requires `dotenv-cli` devDependency or inline `dotenv.config({ path: '.env.staging' })`.)

---

## 8. Test Matrix (Phase 1B)

| Category | Tests | Target |
|---|---|---|
| **Build** | `npm run build` | PASS |
| **Core 1A** | `npm run test:core` | 4/4 PASS |
| **Regression** | `npm test` (fixed) | All existing PASS |
| **SQLite Schema** | Migration up/down, FK, unique constraints | PASS |
| **Transaction** | Rollback on error, atomic multi-table | PASS |
| **Concurrency** | Multiple `addRoute` same topic → conflict | PASS |
| **Queue Dedup** | Same idempotencyKey enqueued once | PASS |
| **Queue Retry** | Transient fail → backoff → success | PASS |
| **Queue Dead-Letter** | Max attempts → dead | PASS |
| **Crash Recovery** | Kill during processing → restart → claim lease | PASS |
| **Restart Persistence** | Events/routes survive process restart | PASS |
| **Legacy Migration** | Dry-run topics/tammi → routes, conflicts detected | PASS |
| **Topic Collision** | Zalo + Tammi same threadId → conflict | PASS |
| **Shadow Adapter Contract** | Zalo inbound → UnifiedEvent persisted; no Telegram send | PASS |
| **Shadow Adapter Contract** | Tammi inbound → UnifiedEvent persisted; no Telegram send | PASS |
| **Zalo/Tammi Regression** | Existing behavior unchanged (manual smoke) | PASS |
| **Security** | No credentials in DB, no secrets in logs | PASS |

---

## 9. Deliverables

1. `docs/implementation/PHASE_01B_PLAN.md` (this file)
2. `docs/implementation/PHASE_01B_TEST_REPORT.md` — after execution
3. `docs/implementation/PHASE_01B_HANDOFF.md` — after execution
4. Updated `docs/implementation/PHASE_STATUS.md`
5. Code changes:
   - `package.json` (scripts, deps)
   - `src/core/db.ts`, `src/core/sqlitePersistence.ts`, `src/core/queue.ts`
   - `src/core/adapters/zaloShadow.ts`, `src/core/adapters/tammiShadow.ts`
   - `src/core/stagingGateway.ts`
   - `tests/sqlite.test.ts`, `tests/queue.test.ts`, `tests/shadowAdapters.test.ts`
   - Fixed `tests/config.test.ts`, `tests/mediaSpoiler.test.ts`

---

## 10. Risk & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `better-sqlite3` native build fails | Medium | Blocks SQLite path | Try `sqlite3` async driver; fallback to `sql.js` WASM; document in handoff |
| Windows test flakiness persists | Medium | Gate BLOCKED | Use subprocess isolation for all config/mediaSpoiler tests; avoid inline singleton tests |
| Shadow adapter misses events | Low | Silent data loss | Add audit_log on every normalized event; compare counts with legacy JSON |
| Staging gateway accidentally uses prod token | Low | Production corruption | Hard guard `NODE_ENV===staging` + separate `.env.staging` file; CI check |
| SQLite locking under concurrent workers | Low | Queue stalls | Single writer process; `busy_timeout=5000`; WAL mode |

---

## 11. Gate Criteria (Phase 1B PASS)

- [ ] TypeScript build PASS
- [ ] Full regression suite PASS (Windows)
- [ ] Core tests PASS
- [ ] SQLite schema migration PASS
- [ ] Transaction rollback PASS
- [ ] Concurrent access PASS
- [ ] Queue dedup/retry/dead-letter/recovery PASS
- [ ] Legacy migration dry-run PASS
- [ ] Topic ownership collision detection PASS
- [ ] Shadow adapters normalize events, no duplicate sends PASS
- [ ] Staging gateway starts isolated, health check PASS
- [ ] No critical/high defects
- [ ] Test evidence recorded, rollback documented

If any mandatory item unverifiable → **GATE BLOCKED**. Do not proceed to Phase 2.

---

## 12. Execution Order

1. Create `docs/implementation/` dir and this plan.
2. Fix `package.json` test scripts + install `better-sqlite3` (verify build).
3. Implement `src/core/db.ts` + schema init.
4. Implement `src/core/sqlitePersistence.ts` (implements same interface as `CorePersistence`).
5. Implement `src/core/queue.ts` (enqueue, claim, retry, recovery).
6. Update `CoreRouter` to use queue (optional: keep direct send for now, queue for outbound).
7. Write SQLite/queue tests.
8. Fix `config.test.ts` / `mediaSpoiler.test.ts` isolation.
9. Implement shadow adapters + staging gateway.
10. Run full test matrix, record evidence.
11. Write `TEST_REPORT.md`, `HANDOFF.md`, update `PHASE_STATUS.md`.

---

**Next action:** install `better-sqlite3` and verify `npm run build` succeeds. If native build fails, evaluate fallback before proceeding.