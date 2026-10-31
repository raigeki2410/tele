# Phase 1 implementation plan

## File plan

1. `src/core/contracts.ts`: stable normalized types and validation.
2. `src/core/persistence.ts`: atomic snapshot repository plus read-only legacy migration.
3. `src/core/router.ts`: account-scoped route lookup and delivery dedupe.
4. `src/core/index.ts`: public boundary.
5. `tests/core.test.ts`: executable acceptance checks.

## Acceptance matrix

| Case | Expected |
|---|---|
| Same external message replay | One canonical event, one delivery |
| Same IDs across accounts | Separate idempotency keys and routes |
| Telegram-originated echo | No outbound Telegram delivery |
| Topic collision | Dry-run conflict, no silent overwrite |
| Backup restore | State returns exactly to backup |
| Legacy files | Read-only; no mutation |
| Zalo/Tammi startup | Unchanged in Phase 1 offline |

## Explicit non-goals

- No production traffic or startup wiring.
- No PostgreSQL/Redis/SQLite migration before approval.
- No WhatsApp/Weixin adapter.
- No dashboard or AI worker.
- No claim that file persistence is multi-process durable.
