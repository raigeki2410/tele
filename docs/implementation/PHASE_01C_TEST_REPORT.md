# Phase 1C Test Report

**Date:** 29/10/2026
**Result:** CODE GATE PASS; LIVE STAGING GATE BLOCKED.

## Evidence

| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run build` | PASS |
| Full regression | `npm test` | 97/97 PASS |
| Combined gate | `npm run check` | PASS |
| Crash recovery | `node --disable-warning=DEP0205 --import tsx --test tests/integration/crashRecovery.test.ts` | 1/1 PASS |
| Staging guard | isolated `assertStagingEnvironment` invocation | PASS |
| Whitespace | `git diff --check` | PASS |
| Audit | `npm audit` | 0 high/critical; 1 low dev-tool finding |

## Covered

- Real legacy Zalo listener emits raw source events to subscribers.
- Tammi SSE receive path emits raw source events to subscribers.
- Shadow adapters attach on `start`, normalize to `UnifiedEvent`, detach on `stop`, remain receive-only.
- Staging startup guard rejects missing, production, malformed, and non-isolated configuration.
- Subprocess marks SQLite delivery as processing, exits abnormally, and restart recovery returns expired work to queued state.

## Not verified

- Live staging Telegram/Zalo/Tammi smoke. Separate credentials and group were not provided.
- Production cutover. Phase remains shadow/opt-in only.
