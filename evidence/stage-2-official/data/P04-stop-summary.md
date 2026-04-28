# P4 STOP - intake-analysis reused stale analysis

Stage 2 official E2E stopped at P4.

## Observation

- Page: `/onboarding/customer/analyze?role=admin`
- Tenant: `media-intel-v1`
- `intake-raw.md` exists and is readable.
- `intake-analysis.md` also exists, but it was generated earlier and references a different intake hash.

## Evidence

- Current `intake-raw.md` sha256: `1bd97a79799572546d04a33ee4adc72595156211f65937228b6a6ac63a7facc0`
- Existing `intake-analysis.md` embedded hash: `0cedcabd184e89b5aa404a863ab7fea9d03db40c29f3325490ab084547832708`
- Existing `intake-analysis.md` generated at: `2026-04-28T01:14:28.643Z`

## Likely Cause

`resolveHarnessRoot()` checks `/Users/clare/Desktop/genesis-harness` before the current fresh clone workspace. The fresh Stage 2 clone at `/Users/clare/Desktop/mc-e2e-test` therefore writes customer vault artifacts into the old harness root when no `MC_HARNESS_ROOT` or `GENESIS_HARNESS_ROOT` env is set.

## Decision

Bad. This invalidates P4 for the official E2E because the analysis is not proven to be generated from the current P3 intake. Stop for fix/decision.
