# Passport OpenAC v3 — AA-aware proof-path routing

**Date:** 2026-06-11
**Status:** Approved (design discussion in session)
**Scope:** `apps/expo` TS only — no Rust / xcframework / circuit changes

## Problem

Real passports fall back to SD-JWT (or hard-error at the proof step) whenever
usable DG15 Active Authentication evidence is missing, even though the
passport-noir 0.3.0 stack fully supports passive-only proofs
(`require_aa = false`, placeholder AA triple, `dg_count = 1`).

Two concrete defects in `apps/expo/src/passport/openacV3.ts`:

1. **Readiness gate fails closed too early.** `assessPassportOpenAcV3Readiness`
   returns `missing-active-authentication` when DG15 bytes are present but
   `activeAuthJson` is absent/unparsable. The native reader
   (`HybridNfcPassport.swift#activeAuthEvidence`) only emits evidence for
   ECDSA-P256 AA keys when AA passed — RSA-AA passports (a large share of
   issuance) always hit this gate and lose the ZK path entirely.
2. **Witness request leaks DG15 into the passive path.**
   `buildPassportOpenAcV3WitnessRequestJson` includes `dg15` in the request
   whenever bytes exist, regardless of `requireAA`. The Rust builder treats
   `(Some(dg15), None evidence)` as fail-closed (`missing-active-auth-witness`),
   so even if the readiness gate passed, the witness build would fail.

## Design

Three-tier routing, decided by an explicit AA mode:

| Chip state | aaMode | Path | Trust band |
|---|---|---|---|
| DG15 bytes + parsable ECDSA AA evidence | `active` | OpenAC v3, `requireAA = true`, DG15 in request | green (L3+) |
| DG15 bytes, no usable evidence (RSA AA / AA failed) | `passive` | OpenAC v3, `requireAA = false`, **DG15 omitted from request** | blue (L3) |
| No DG15 bytes | `passive` | OpenAC v3, `requireAA = false` (existing path) | blue (L3) |
| Simulated chip / passive-auth failed / missing SOD-DG1 / revocation snapshot problems | — | SD-JWT fallback (simulated) or surfaced error (real chip), unchanged | white (L1) |

### Changes (all in `apps/expo`)

1. `src/passport/openacV3.ts`
   - New exported type `PassportOpenAcV3AaMode = 'active' | 'passive'`.
   - `assessPassportOpenAcV3Readiness`: drop the `missing-active-authentication`
     fail branch; the ready variant gains
     `aaMode: 'active' | 'passive'` (`active` ⟺ DG15 bytes present AND
     `parsePassportOpenAcV3ActiveAuthJson` returns evidence).
   - Remove `'missing-active-authentication'` from
     `PassportOpenAcV3NotReadyReason` and its case in
     `describePassportOpenAcV3Unavailable`.
   - `buildPassportOpenAcV3WitnessRequestJson`: include `dg15` in
     `dataGroups` **iff `requireAA` is true**. The existing
     `requireAA && !hasBytes(dg15)` throw stays. This guarantees the Rust
     builder never sees `(Some(dg15), None)`.
2. No change to `app/passport/index.tsx`: `requireAA` derivation
   (`hasBytes(dg15) && activeAuth !== null`) and the green/blue banding via
   `hasOpenAcV3ActiveAuthentication` already match `aaMode` semantics.
3. No change to `src/passport/diagnostics.ts`: `AA_MISSING_INPUTS_RE` keeps
   matching the Rust fail-closed reasons, which remain reachable only on the
   `requireAA = true` path.

### Security note

`require_aa` is a public circuit input. A passive-only proof makes no
anti-cloning claim and verifiers see that; degrading DG15-without-evidence to
passive does not inflate trust — the credential lands on the blue (L3) band,
not green (L3+).

## Testing

`__tests__/unit/passportOpenAcV3.test.ts`:

- Rewrite "fails closed when DG15 is present but AA evidence is absent" →
  readiness is ready with `aaMode: 'passive'`, plan kind `openac-v3`.
- `aaMode: 'active'` asserted on the full-evidence readiness test;
  `aaMode: 'passive'` on the no-DG15 test.
- New: witness request with DG15 bytes + `requireAA: false` omits `dg15`.
- New: `resolvePassportOpenAcV3WitnessBundleJson` with DG15 bytes and no
  `activeAuthJson` (the RSA-AA chip shape) sends `requireAA: false` and no
  `dg15`.

## Verification

On-device with the real passport that currently falls back. If it still
degrades, the `[zk] OpenAC v3 read-stage witness skipped — <reason>` log line
identifies the next blocker (passive-auth / SOD parse / attestation), which is
out of scope here.

## Deferred

- Rust-side defensive degrade (`(Some(dg15), None) + require_aa=false` →
  passive instead of fail-closed) — needs a passport-noir release + xcframework
  pin bump; not required once the TS side stops sending that shape.
