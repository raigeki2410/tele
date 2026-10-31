# Phase 1C Handoff

## Delivered

- npm audit remediation: unused `adm-zip` removed; high findings cleared.
- Zalo `subscribeZalo` and Tammi `subscribeTammi` source hooks.
- Receive-only shadow adapters wired to live legacy event sources after `start()`.
- Staging validation gateway and `.env.staging.template`.
- SQLite subprocess crash/recovery integration test.
- 97 passing tests and clean diff whitespace gate.

## Operations

1. Copy `.env.staging.template` to ignored `.env.staging`.
2. Set unique staging `TG_TOKEN`, `TG_GROUP_ID`, `DATA_DIR`, and staging Zalo credentials.
3. Start only with `DEPLOY_ENV=staging` and `STAGING_GATEWAY_STARTUP_CHECK=1`.
4. Run live smoke only against staging group. Do not attach production token/group.

## Rollback

- Do not instantiate `ZaloShadowAdapter` or `TammiShadowAdapter`; legacy forwarding remains unchanged.
- Remove staging environment values; guard has no production startup side effects.
- SQLite queue keeps WAL recovery behavior and has no automatic production migration.

## Remaining gate

Live staging smoke remains blocked on separate staging credentials/group. Residual audit: one low esbuild development-server finding. Do not start Phase 2 until live staging event and recovery smoke pass.
