# Passport show-phase presentation — small QR, fresh proofs, closed verify loop

**Date:** 2026-06-12
**Status:** Approved (design discussion in session)
**Scope:** Phase 1 of 3 — face-to-face presentation. `apps/expo` TS only; no circuit / Rust / xcframework changes.

## Problem

1. **QR too large.** A passport presentation today wraps the whole enrollment
   `passport_v3` envelope (3 UltraHonk proofs + 3 vks, ~65–70 KB of base64)
   into the VP JSON → 30+ animated `sqc1` frames (~40 s loop). UltraHonk
   proofs are ~14–16 KB *regardless of circuit size*, so reverting to legacy
   circuits would not shrink the QR — the fix is what travels in the QR.
2. **Replayed show proof.** The `openac_show` proof is generated once at
   enrollment; every presentation replays it. Its `nonce_hash` and
   `current_*` (today) public inputs are frozen at enrollment, so verifier
   freshness and even "over 18 *today*" are not actually proven.
3. **No verifier.** Nothing on the scan side verifies `passport_v3` payloads
   (`proofVerifier.ts` is JWT-only). The 70 KB buys no verification.
4. **vk travels with the proof.** Verifying against a prover-supplied vk is
   meaningless unless the vk is pinned.

The passport-noir design already anticipated the fix: the witness builder
ships `openac_show` inputs with a placeholder device signature, expecting the
app to swap `nonce_hash` and re-sign "just before proving". The OpenAC
prepare/show split exists precisely so presentations carry only the light
show proof.

## Design (Phase 1 — face-to-face)

### Show-witness vault

At enrollment persist the full OpenAC v3 witness bundle JSON (all three
input maps), AES-GCM encrypted in local storage, keyed by credential id.
This contains the commitment opening (claims field, link_rand, hash halves,
device pk) — it never leaves the device. Deleted together with the
credential.

### Per-presentation show proof

For each presentation, starting from the vaulted `openAcShowInputsJson`:

| Input | Swap to |
|---|---|
| `nonce_hash` | verifier challenge (32 bytes) or time-bucket digest |
| `current_year/month/day` | today |
| `disclose_age` / `disclose_nationality` | user's claim selection in the present sheet |
| `out_is_older` | recomputed honestly from the packed `claims` field (BE-72-bit: year·2^40 + month·2^32 + day·2^24 + nat) vs today and `age_threshold`; `0` when age not disclosed (circuit pins the sentinel) |
| `out_nationality` | decoded nationality bytes when disclosed, else `[0,0,0]` |
| `signature` | fresh Secure-Enclave ECDSA over the new `nonce_hash` via `signOpenAcDeviceBindingDigest` (biometric-gated → satisfies the "Face ID on present" rule) |

`epoch`, `link_scope`, `link_mode`, `out_link_tag`, commitment outputs stay
at enrollment values (pseudonym stability). All witness values remain
decimal-string maps (native prover rejects numbers — PassportZk Code=2).

Then `generateNoirProof('openac_show', merged SRS)` — the small circuit
(~150 KB) on the presentation hot path; the heavy prepare circuits never run
again.

### Presentation envelope `gg.solidarity.passport.show-presentation.v1`

```
{ schema, proofType: 'passport_show_v1', passportNoirVersion,
  circuit: 'openac_show', proofB64, vkB64,
  publicInputs: { nonceHashB64, linkScope, epoch, today, ageThreshold,
                  discloseAge, discloseNationality, commitmentX, commitmentY,
                  linkTag, outIsOlder, outNationality },
  freshness: 'challenge' | 'time-bucket',
  holderDid, selectedClaims }
```

No prepare proofs. One proof + one vk ≈ 16–18 KB → ~8–9 `sqc1` frames
(vs 30+ today). The envelope goes through the existing
`compressForQR`/`buildPresentationQrPages` path.

### Challenge QR `gg.solidarity.passport.show-challenge.v1`

Verifier-issued single-frame QR: `{ schema, nonceHashB64 (32 random bytes),
scope, ageThreshold, requestAge, requestNationality, issuedAt }`. The
verifier remembers its outstanding nonce (TTL ~5 min) and accepts an
envelope only if `nonce_hash` matches.

**Time-bucket fallback** (holder-only flow, no challenge available):
`nonce_hash = sha256('solidarity.passport.show.bucket.v1' | scope | UTC
YYYY-MM-DD | HH | floor(minute/10))`. Verifier recomputes current and
previous bucket. Weaker (replayable ≤ ~20 min); envelope labels it
`freshness: 'time-bucket'` and the verifier UI must show the distinction.

### Verifier (scan side)

`envelopeHandler.ts` learns the show-presentation schema. Verification:

1. Structural parse + schema/version checks.
2. **vk pin:** `sha256(vkB64 bytes)` must equal the pinned hash. Pin order:
   build-time constant → self-pin recorded at this device's own enrollment
   (same circuit ⇒ same vk; trust-on-first-use, labeled) → fail closed with
   an actionable error. Never verify against an unpinned vk.
3. `verifyNoirProof(proof, vk)` via the existing nitro passport-zk module.
4. Extract the 49 public-input fields prepended to the proof bytes
   (credential_type, nonce_hash[32], link_mode, link_scope, epoch, y/m/d,
   age_threshold, disclose_nationality, disclose_age, commitment x/y,
   link_tag, out_is_older, out_nationality[3]) and cross-check them against
   the envelope's `publicInputs` — the envelope is display data; the proof
   bytes are the truth.
5. Freshness: challenge match or time-bucket recompute; `credential_type ==
   DOMAIN_PASSPORT`; `today` within ±1 day.
6. Outcome: trust band display (show proof alone attests L3-band "valid ZK
   passport presentation"; AA-ness is a prepare-phase property not visible
   here) + disclosed predicate values read from public outputs, not from
   envelope claims.

### UI

- **Holder:** present sheet on `credentials/[id]` — for `passport-openac-v3`
  credentials with a vaulted witness: "掃描驗證方 QR" (challenge mode) or
  "直接出示" (time-bucket), then Face ID → progress → animated QR. Legacy
  path untouched for non-v3 credentials.
- **Verifier:** scan screen gains a "出示驗證" entry → full-screen challenge
  QR → back to camera → scan result shows verify outcome + disclosed claims.

### Out of scope (later phases)

- Phase 2: OIDC consent Approve → same envelope as `vp_token` (nonce from
  the auth request).
- Phase 3: BLE deep-verify transferring prepare proofs on first contact;
  per-verifier scope pseudonyms (needs prepare re-run per scope).

## Security notes

- The show proof proves commitment possession + device key possession +
  predicates; it does NOT by itself prove the commitment came from a real
  passport — that is the prepare chain, deferred to deep-verify. The
  verifier UI must not over-claim (band copy: ZK 出示有效, not 護照鏈已驗證).
- Witness vault contents are commitment-opening secrets: AES-GCM at rest,
  never in QR/logs/backups beyond existing encrypted-store policy.
- `out_is_older` is recomputed honestly; an underage holder yields
  `false` — the circuit's CRITICAL-2 sentinels prevent forging via
  unconstrained outputs.

## Testing

- Pure-logic units (bun test): claims-field decode (incl. year boundary
  1950/2049), input-map swap (string-map invariants, sentinel rules),
  envelope build/parse round-trip, time-bucket derivation + acceptance
  window, challenge build/parse, public-input field extraction from
  synthetic proof bytes, vk pin order + fail-closed.
- Nitro-dependent paths injected (same pattern as
  `PassportOpenAcV3Prover`/`WitnessBuilder` interfaces) so the proving/verify
  orchestration is unit-testable.
- On-device: enroll → present (both freshness modes) → scan on second
  device; measure frame count.
