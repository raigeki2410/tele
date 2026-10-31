# Phase 1C Security Report

**Date:** 29/10/2026
**Result:** High findings remediated. One low dev-tool finding remains.

## Audit

| Command | Result |
|---|---|
| `npm audit` before remediation | 5 high, 1 low |
| `npm audit fix` | Updated transitive dependencies including `axios` and `@xmldom/xmldom` |
| Remove unused direct `adm-zip` | Removed all high `adm-zip` findings |
| `npm audit` after remediation | 1 low, 0 high, 0 critical |

Remaining: `esbuild` 0.27.3-0.28.0, GHSA-g7r4-m6w7-qqqr. It affects Windows development-server file reads. Production does not run an esbuild dev server. `npm audit fix` reports no compatible fix; upgrade `tsx`/esbuild together before enabling any dev server on untrusted networks.

## Dependency disposition

- Removed unused direct runtime `adm-zip` dependency. `@types/adm-zip` remains dev-only and has no runtime package dependency.
- Lockfile updates remediate `axios` and `@xmldom/xmldom` findings.
- No credentials, live endpoints, or production traffic used.

## Staging isolation

`src/core/stagingGateway.ts` requires `DEPLOY_ENV=staging`, valid separate Telegram token/group, separate `DATA_DIR`, and refuses `NODE_ENV=production` or `PRODUCTION=1`. `.env.staging.template` is tracked; `.env.staging` remains ignored.
