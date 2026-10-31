# Phase 1 Unified Core — handoff

Ngày: 28/10/2026
Trạng thái: `IMPLEMENTED_OFFLINE / PRODUCTION_BLOCKED`

## Phạm vi đã làm

- `src/core/contracts.ts`: `PlatformAdapter`, `UnifiedEvent`, core ID gồm `platform`, `account`, `conversation`, `message`; runtime validation; idempotency key.
- `src/core/persistence.ts`: atomic JSON snapshot, account/route/event/delivery records, backup/restore, dry-run migration từ `topics.json` và `tammi-topics.json`.
- `src/core/router.ts`: route theo platform + account + conversation, inbound dedupe, echo suppression, delivery state.
- `tests/core.test.ts`: contract, replay dedupe, route isolation, migration conflict, rollback.

## Quyết định

- Không nối core vào `src/index.ts`; Zalo/Tammi behavior và Telegram polling ownership giữ nguyên.
- Không thêm PostgreSQL/Redis/SQLite dependency. File snapshot native phù hợp Node >=20.11 nhưng chưa đủ cho multi-process durability; queue Phase 1 chỉ thể hiện delivery state, chưa thay thế worker queue.
- Không chuyển traffic production, không chạy migration trên data thật.

## Migration / rollback

1. Read-only load `data/topics.json` và `data/tammi-topics.json` thành `LegacyMigrationInput`.
2. Chạy `dryRunLegacyMigration`; dừng nếu có conflict.
3. Backup core snapshot bằng `CorePersistence.backup()`.
4. Apply routes trong staging; verify route count, composite topic key, account/conversation isolation.
5. Rollback bằng `CorePersistence.restore(backupPath)`; legacy files không bị sửa.

## Gate

- Build: PASS.
- Core tests: cần chạy qua command tương thích Windows.
- Legacy integration/E2E: NOT RUN.
- PostgreSQL/Redis approval: chưa có.
- Production traffic switch: BLOCKED.

## Next approval

Approve persistence/queue choice, then add adapter wrappers and a staging-only gateway behind feature flag. Do not enable in production until Zalo/Tammi replay and rollback tests pass.
