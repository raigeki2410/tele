# Phase 2A Implementation Plan

**Date:** 29/10/2026
**Status:** AUDIT COMPLETE; PLAN DEFINED
**Baseline:** Phase 1C CODE GATE PASS / LIVE STAGING GATE BLOCKED. All regression tests pass (97/97). One low `esbuild` dev-tool audit finding remains. Uncommitted changes are present from Phase 1C work.

---

## Priority Change Summary

Immediate priority:
1. Restore reliable Zalo ↔ Telegram operation.
2. Build a web dashboard for account and runtime management.
3. Separate bridge from dev tools/dashboard processes.
4. Support dashboard updates without Zalo worker restart.
5. Implement controlled updates for backend/bridge.
6. Maintain SQLite persistence and durable queue.

WhatsApp, WeChat, LLM deferred. Phase 1C findings (staging blocked, esbuild low) remain tracked.

---

## 2A.0 — Autonomous Audit & Plan (Complete)

**Goal:** Understand current state, identify issues, define Phase 2A plan.

**Findings:**
*   **Git Status:** Uncommitted changes from Phase 1C are present (modified `.gitignore`, `package-lock.json`, `package.json`, `src/config.ts`, `src/tammi/bridge.ts`, `src/zalo/handler.ts`, `tests/config.test.ts`, `tests/mediaSpoiler.test.ts`, `tests/store.test.ts`; untracked `docs/`, `src/core/`, `tests/` folders). These need to be committed as part of Phase 1C completion before starting Phase 2A.
*   **Zalo Status:** Zalo ↔ Telegram bridge is likely not fully operational in a live environment due to missing or invalid `credentials.json` (as per Phase 1C `LIVE STAGING GATE BLOCKED` and `src/index.ts` auto-login failure logging). The code path for Zalo login, reconnection, and message handling appears stable.
*   **Existing Architecture:**
    *   Single NodeJS process (`src/index.ts`) handles both Zalo and Telegram.
    *   `telegraf` for Telegram bot polling (no explicit HTTP server in `src/index.ts` for Telegram).
    *   `zca-js` for Zalo connection; handles login, QR, events.
    *   `better-sqlite3` for persistence and durable queue.
    *   `src/lifecycle.ts` provides graceful shutdown.
    *   Tammi integration (optional, uses `hermes-tammi-plugin` as subprocess for its bridge).
*   **Runtime Processes:** The current setup is a single Node.js process. A web dashboard and separate control API will require new, independent processes.
*   **Zalo Restoration:** Existing Zalo bridge can be restored without major refactor. The code supports auto-login (if credentials exist) and manual QR login. Reconnection logic is present.
*   **npm Audit:** One low severity vulnerability in `esbuild` (0.27.3 - 0.28.0) related to Windows development server, as noted in Phase 1C. Not critical for production runtime.
*   **Documentation:** Phase 1B/1C documents provide good context for current state, SQLite, queue, shadow adapters, and staging.

**Next Action:** Commit outstanding Phase 1C changes to establish a clean baseline.

---

## 2A.1 — Restore Zalo Bridge

**Goal:** Restore Zalo ↔ Telegram functionality with minimum changes, verifying session preservation, routing, and authentication.

**Dependencies:**
*   Clean Git working tree (commit Phase 1C changes).
*   Access to valid staging Zalo credentials and Telegram bot token/group ID.

**Acceptance Criteria:**
*   Existing build and regression tests pass.
*   Safe restore procedure documented.
*   Zalo session and Telegram topic mappings preserved across restarts.
*   Staging inbound/outbound routing verified (Zalo → Telegram, Telegram → Zalo).
*   Zalo authentication (QR, reconnect) verified on staging.
*   Telegram bot authentication verified on staging.
*   No duplicate polling/messages on staging.
*   Compatibility with new Core confirmed.
*   Documentation of any session/subscription limitations.
*   Live operation explicitly marked unverified.

**Test Commands:**
1.  `git commit -am "Phase 1C: Final changes and reports."` (or similar for Phase 1C changes)
2.  `npm run check` (TypeScript build, full regression)
3.  Set up `.env.staging` with valid staging `TG_TOKEN`, `TG_GROUP_ID`, `DATA_DIR`, `ZALO_CREDENTIALS_PATH`.
4.  Run staging environment: `DEPLOY_ENV=staging STAGING_GATEWAY_STARTUP_CHECK=1 node --disable-warning=DEP0205 --import tsx src/index.ts`
5.  Perform `/login` (Zalo QR) via Telegram on staging.
6.  Send messages Zalo → Telegram, Telegram → Zalo on staging.
7.  Verify reply, media, reactions on staging.
8.  Restart staging process, verify session persistence and continued routing.
9.  Run `npm audit`.

**Rollback Procedure:**
1.  Stop the bridge process.
2.  Delete or rename `credentials.json` and `core.db` files in `DATA_DIR` if corrupted.
3.  Revert to the last stable Git commit.
4.  Restart the bridge without attempting Zalo login (if reverting to pre-2A.1 state) or use known-good credentials.
---

## 2A.2 — Independent Runtime Supervisor

**Goal:** Separate application into Zalo Bridge Worker, Telegram Gateway (current combined process), Tele Control API, and Tele Web Dashboard processes, with a supervisor managing the worker.

**Dependencies:**
*   Zalo Bridge functionality restored and stable (2A.1 PASS).
*   Decision on whether to split Telegram Gateway from Zalo Bridge immediately or keep them combined initially. *Initial plan: keep Zalo/Telegram combined worker, add separate Control API and Dashboard.*

**Architecture Plan:**
*   **Zalo/Telegram Worker:** The existing `src/index.ts` process. This will be the managed worker.
*   **Tele Control API:** A new Node.js Express/Fastify application. Exposes REST endpoints for dashboard to interact with worker (e.g., status, restart, account management). Communicates with worker via IPC (e.g., `child_process` messaging, named pipes, or HTTP if worker also exposes an API).
*   **Tele Web Dashboard:** A React/TypeScript/Vite application. Serves static assets. Communicates with Tele Control API.
*   **Supervisor:** A separate process (e.g., a simple Node.js script or a dedicated process manager like `pm2` for Windows deployments).
    *   Starts `Zalo/Telegram Worker` and `Tele Control API`.
    *   Monitors their status.
    *   Handles restarts with backoff.
    *   Prevents duplicates.
    *   Provides graceful shutdown.

**Acceptance Criteria:**
*   Worker, API, Dashboard can be started and stopped independently.
*   Supervisor starts/monitors worker, API.
*   Worker crash detected and restarted with backoff.
*   Dashboard restart does not affect worker.
*   API restart does not affect worker.
*   Duplicate worker instances prevented.
*   Session recovery after worker restart verified.
*   Graceful shutdown of all components.
*   Restart backoff prevents loops on login invalid/account kicked.
*   Windows compatibility ensured.

**Test Commands:**
1.  Develop basic supervisor script.
2.  Develop basic Control API (e.g., `/status` endpoint that reads worker status).
3.  Integrate supervisor to launch `src/index.ts` (worker) and Control API.
4.  `npm run check`
5.  Start supervisor. Verify worker and API start.
6.  Manually kill worker process (e.g., via Task Manager or `kill -9`). Verify supervisor restarts it.
7.  Restart Control API. Verify worker not affected.
8.  Restart Dashboard (if already implemented). Verify worker not affected.
9.  Introduce a simulated Zalo login failure in worker. Verify backoff.

**Rollback Procedure:**
1.  Stop all new supervisor, API, dashboard processes.
2.  Revert code changes related to supervisor, API, dashboard.
3.  Run the original `src/index.ts` directly.
---

## 2A.3 — Web Dashboard

**Goal:** Implement a responsive React/TypeScript/Vite web dashboard for management.

**Dependencies:**
*   Independent Runtime Supervisor functioning (2A.2 PASS).
*   Tele Control API with initial endpoints for status, account.

**Technology Stack:**
*   Frontend: React, TypeScript, Vite.
*   Component System: TBD (e.g., Tailwind CSS + Headless UI, or a component library like Chakra UI/MUI if appropriate).
*   Communication: Fetch API to Tele Control API.

**Acceptance Criteria:**
*   Dashboard starts and displays basic overview.
*   HMR works for frontend development (no Zalo worker restart).
*   Overview page displays Zalo/Telegram status, metrics (mock data initially if API not ready).
*   Account Management allows viewing accounts, triggering Zalo QR login, reconnect.
*   Conversations page displays mappings.
*   Bridge Control displays worker status, allows controlled restart (with confirmation).
*   Logs/Diagnostics page shows structured logs (from API).
*   Settings page allows basic configuration (hot-reloadable/restart-required identified).
*   No exposure of credentials/secrets.
*   Responsive UI.
*   E2E tests using Playwright.

**Test Commands:**
1.  `npm run check`
2.  Start supervisor.
3.  Start dashboard development server (`npm run dev:dashboard`).
4.  Verify HMR by changing UI code.
5.  Access dashboard, verify overview.
6.  Test Zalo QR login flow via dashboard.
7.  Test worker restart via dashboard (with confirmation).
8.  Develop E2E tests (`playwright test`).

**Rollback Procedure:**
1.  Stop dashboard and API processes.
2.  Revert dashboard and API related code. The core worker (`src/index.ts`) should be unaffected.

---

## 2A.4 — Update Without Continuous Restarts

**Goal:** Implement distinct update classes: Frontend, Hot Config, Backend/Bridge, minimizing restarts.

**Dependencies:**
*   Web Dashboard functional (2A.3 PASS).
*   Control API extended for configuration and update management.

**Acceptance Criteria:**
*   Frontend changes do not restart Zalo worker.
*   Dashboard restart does not restart Zalo worker.
*   API restart does not restart Zalo worker (if separated).
*   Hot configuration updates applied without worker restart for designated settings.
*   Restart-required settings clearly identified and prompt for worker restart.
*   Failed backend/bridge candidate builds do not affect running workers.
*   Rollback procedure restores previous staging version after failed update.
*   Session and topic mappings survive worker updates.
*   No auto Git pull + restart.
*   No simultaneous ownership of Zalo session/Telegram polling.

**Test Commands:**
1.  `npm run check`
2.  Start full system (supervisor, worker, API, dashboard).
3.  Make a UI change, rebuild/deploy dashboard. Verify Zalo worker unaffected.
4.  Change a "hot" configuration setting via dashboard. Verify effect without worker restart.
5.  Change a "restart-required" setting. Verify dashboard prompts for worker restart.
6.  Simulate a backend/bridge update:
    *   Build a new version in a temporary location.
    *   Attempt to activate.
    *   If activation fails, verify rollback to previous version.
    *   If activation succeeds, verify worker functionality and data persistence.
7.  Verify data persistence (sessions, mappings) across updates.

**Rollback Procedure:**
*   **Frontend:** Deploy previous static assets.
*   **Hot Config:** Revert configuration value via API.
---

## 2A.5 — Testing & Acceptance

**Goal:** Comprehensive testing and final acceptance of Phase 2A deliverables.

**Dependencies:**
*   All previous milestones complete and stable (2A.4 PASS).

**Test Matrix:**
1.  **TypeScript build:** `npm run build`
2.  **Regression baseline:** `npm test` (existing 97 tests + new tests)
3.  **Dashboard component tests:** (New, e.g., Jest/React Testing Library)
4.  **API contract tests:** (New, for Tele Control API)
5.  **Authentication/Authorization:** Test Zalo login, Telegram admin checks.
6.  **Worker lifecycle:** Start, stop, crash, restart, graceful shutdown.
7.  **Process isolation:** Verify independence of worker, API, dashboard.
8.  **SQLite recovery:** `tests/integration/crashRecovery.test.ts`
9.  **Queue recovery:** Covered by existing `tests/queue.test.ts` and `crashRecovery.test.ts`.
10. **Zalo adapter regression:** Covered by existing tests.
11. **Telegram routing regression:** Covered by existing tests.
12. **Playwright browser E2E:** For dashboard navigation and control.
13. **Hot update isolation:** Verify frontend, config updates don't restart worker.
14. **Candidate update & rollback:** Test full backend deployment cycle.
15. **Dependency security audit:** `npm audit`.

**Acceptance Criteria:**
*   All tests (unit, integration, E2E) pass.
*   Zalo ↔ Telegram reliably operates in staging.
*   Dashboard displays real runtime/account status in staging.
*   Dashboard development does not restart Zalo worker.
*   Runtime supervisor functions correctly.
*   Account/mapping persistence preserved across all operations.
*   Controlled update/rollback tested successfully.
*   No unresolved critical/high security issues (or explicit risk acceptance).
*   `PHASE_02A_PLAN.md`, `PHASE_02A_TEST_REPORT.md`, `PHASE_02A_HANDOFF.md`, `PHASE_02A_UPDATE_STRATEGY.md`, `PHASE_02A_ZALO_RECOVERY.md` created.
*   `PHASE_STATUS.md` updated.
*   Live staging verification report provided (explicitly stating BLOCKED if credentials missing).

**Test Commands:** (Full suite, see Test Matrix above)

**Rollback Procedure:**
1.  Revert all code to Phase 1C.
2.  Restore `docs/implementation/PHASE_STATUS.md` to Phase 1C status.

---

## Phase Gate Management

*   `2A.0_AUDIT` (Complete)
*   `2A.1_ZALO_RECOVERY`
*   `2A.2_RUNTIME_SUPERVISOR`
*   `2A.3_WEB_DASHBOARD`
*   `2A.4_UPDATE_ISOLATION`
*   `2A.5_E2E_RELEASE_GATE`

**Workflow:** PLAN → IMPLEMENT → TEST → FIX → REGRESSION → GATE REVIEW.

If blocked by missing live credentials, continue independent offline development, but do not bypass the blocked live gate.

---

## Required Documentation (Output files for Phase 2A)

*   `docs/implementation/PHASE_02A_PLAN.md` (This file)
*   `docs/implementation/PHASE_02A_TEST_REPORT.md`
*   `docs/implementation/PHASE_02A_HANDOFF.md`
*   `docs/implementation/PHASE_02A_UPDATE_STRATEGY.md`
*   `docs/implementation/PHASE_02A_ZALO_RECOVERY.md`
*   Update `docs/implementation/PHASE_STATUS.md`

---

## Final Acceptance

Phase 2A is complete only when:
*   Zalo ↔ Telegram reliably runs in an authorized environment.
*   Dashboard can display real runtime and account status.
*   Dashboard development does not restart Zalo.
*   Runtime supervisor functions correctly.
*   Account and mapping persistence is preserved.
*   Controlled update and rollback are tested.
*   All mandatory regression tests pass.
*   No unresolved critical/high-severity security issues remain without explicit risk acceptance.

Never claim production operation was verified without a live authorized smoke test. Do not deploy to production or activate live accounts without explicit authorization.
*   **Backend/Bridge:** Activate previously deployed stable version using the supervisor. Database migrations should be reversible or additive; ensure no data loss.