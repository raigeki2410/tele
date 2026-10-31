# Phase 1B Test Report

**Date:** 29/10/2026
**Result:** CODE GATE PASS; LIVE STAGING GATE BLOCKED (credentials/environment absent).

## Evidence

| Check | Command | Result |
|---|---|---|
| Native SQLite install | `npm install better-sqlite3 --save` | PASS |
| Type declarations | `npm install -D @types/better-sqlite3` | PASS |
| TypeScript | `npm run build` | PASS |
| Phase 1A core | `npm run test:core` | 4/4 PASS |
| SQLite / queue / adapters | `node --import tsx --test --test-concurrency=1 tests/sqlite.test.ts tests/queue.test.ts tests/shadowAdapters.test.ts` | 3/3 PASS |
| Full regression | `npm test` | 96/96 PASS |

## Covered

- SQLite schema initializes with WAL, FK, busy timeout, recovery of expired leases.
- SQLite persistence survives reopen; event idempotency rejects replay.
- Durable queue deduplicates enqueue, claims work atomically, completes, and recovers expired processing lease.
- Shadow adapters normalize inbound Zalo/Tammi events and reject outbound `send`.
- Windows-compatible test scripts; config/media spoiler/store tests isolated from real `.env` and shared data.

## Not Verified

- Real Zalo listener attachment: legacy handler has no public event subscription API.
- Real Tammi SSE attachment: bridge has no public receive subscription API.
- Live staging Telegram bot/group smoke: no staging credentials provided.
- Crash process-kill scenario and retry-to-dead timing: queue primitives covered, process integration not added.

## Security

`npm install` reported 6 dependency audit findings: 1 low, 5 high. No audit remediation run because lockfile-wide upgrades may be breaking. Run `npm audit` and remediate separately.