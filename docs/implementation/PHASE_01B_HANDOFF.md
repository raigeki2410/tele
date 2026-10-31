# Phase 1B Handoff

## Delivered

- Cross-platform npm scripts and deterministic test isolation.
- `better-sqlite3` WAL database bootstrap in `src/core/db.ts`.
- SQLite-backed persistence in `src/core/sqlitePersistence.ts`; JSON backup/restore retained.
- Lease-based durable queue in `src/core/queue.ts`.
- Receive-only Zalo/Tammi shadow adapter contracts in `src/core/adapters/`.
- 96 passing tests, including SQLite, queue, adapters, Phase 1A, and regressions.

## Compatibility

Production `src/index.ts` remains unchanged. Existing JSON persistence remains available. New SQLite exports are opt-in through `src/core/index.ts`.

## Rollback

1. Stop any process using Core SQLite.
2. Remove imports/instantiation of `SqliteCorePersistence` or `DurableQueue` from caller.
3. Resume `CorePersistence` with existing JSON snapshot.
4. Keep or remove SQLite files (`core.db`, `core.db-wal`, `core.db-shm`); no production data was migrated by this phase.

## Next Work

1. Expose non-Telegram event subscriptions from legacy Zalo handler and Tammi bridge.
2. Wire shadow adapters only after those source APIs exist.
3. Add staging-only entrypoint after separate staging token/group are supplied.
4. Add process-level kill/restart worker test and retry/dead-letter timing tests.
5. Review 5 high npm audit findings before deployment.

## Gate

Code/test gate PASS. Phase 2 remains BLOCKED until live staging isolation and real-source shadow smoke tests pass.