# Passport proof performance — warm prover, background prepare, single Face ID

**Date:** 2026-06-13
**Status:** Approved (design discussion in session)
**Scope:** `apps/expo` TS + `nitro-modules/passport-zk` + `nitro-modules/spruce-did`
+ passport-noir mopro binding (Rust, sibling repo — lands via xcframework pin bump).
Builds on the 2026-06-12 show-presentation spec (fresh `openac_show` per present).

**Targets (acceptance):**

| Flow | Today | Target |
|---|---|---|
| Show, challenge mode (warm) | ≫2 s | ≤ 2 s after challenge scan |
| Show, time-bucket mode | ≫2 s | QR on screen ~immediately (pre-proven) |
| Prepare (enrollment proofs) | foreground, ≫10 s | background, 5–10 s typical device |
| Face ID prompts per flow | 2 (legacy-key devices) | exactly 1 |
| Progress UI | fake 5 s movie | real milestones only |

## Problem

1. **Prepare does 6 native passes, one of them pointless.**
   `generatePassportOpenAcV3ProofPayload` (`apps/expo/src/passport/openacV3.ts:654-676`)
   proves `dsc_chain` → `passport_adapter` → `openac_show` sequentially, each
   followed by an on-device verify. But the show flow regenerates a fresh
   `openac_show` per presentation (2026-06-12 spec), so the enrollment show
   proof is dead weight — its only surviving use is the vk self-pin extracted
   at persist (`app/passport/index.tsx:585`), which
   `getNoirVerificationKey('openac_show')` can produce without proving.

2. **Every native call cold-starts.** `HybridPassportZk.swift` resolves
   bundle paths per call and hands them to mopro; nothing is cached on the
   Swift side, so each prove/verify re-reads the 128 MB merged
   `passport.srs.bin`, re-parses the circuit JSON, and redoes barretenberg
   setup. This fixed cost does not shrink with circuit size, which is why
   `openac_show` (146 KB ACIR vs 1.4 MB for the prepare pair) does not show
   the expected order-of-magnitude speedup. (Whether the pinned Rust crate
   caches internally is unverified — the instrumentation PR below settles it;
   the design assumes it does not.)

3. **Show is fully serial and pays avoidable costs**
   (`useShowPresentation.ts:94-143` → `showPresentation.ts:285-331`):
   MMKV decrypt → nitro lazy-load → Face ID sign → prove → on-device
   self-verify → compress → QR pages. The Face ID wait (user-paced) sits in
   the middle of the chain; the self-verify roughly doubles the native cost;
   and the envelope ships the full vk (~2 KB+) even though verification is
   pin-based, inflating the QR frame count.

4. **Face ID fires twice on legacy-key devices.** Two independent gates
   stack: the JS prompt `requireBiometric('sign')`
   (`src/keychain/signingKey.ts:349`) and, for installs whose
   `solidarity.master.v2` key is a pre-syncable Secure Enclave key created
   with `[.privateKeyUsage, .userPresence]`
   (`nitro-modules/spruce-did/ios/SpruceDidKeyStore.swift:38-40`), the
   system's own prompt inside `SecKeyCreateSignature`
   (`HybridSpruceDid.swift` `signRawP256`). The native code already
   anticipates this (`biometricpromptcancelled` event). Android auth-bound
   keystore keys stack the same way. No `LAContext` /
   `kSecUseAuthenticationContext` reuse exists anywhere. Fresh iOS installs
   (syncable key, no ACL — `SpruceDidKeyStore.swift:100-103`) prompt once.

5. **The progress overlay is fiction.** `CryptoCompilingOverlay.tsx:80-99`
   plays a hardcoded timeline — "[ VERIFIED ]" at 3.5 s, `onCompletion` at
   5 s — while real proving runs tens of seconds. At the only mount site
   (`app/passport/index.tsx:658`) `onCompletion` isn't wired and `visible`
   tracks `state.isLoading`, so the overlay freezes on a false "[ VERIFIED ]"
   until proving actually ends. The real per-circuit progress messages
   (`index.tsx:770-776`) are never rendered by it. This violates CLAUDE.md
   rule 8 (no fake data).

## Design

### 0. Instrumentation first (separate, first PR)

Per-stage timing logs before any optimization, so the baseline and each win
are measured, not guessed: per-circuit `generateNoirProof` /
`verifyNoirProof` ms (JS side, around the existing `[zk]` logs), witness
vault decrypt ms, nitro lazy-load ms, sign wait ms (Face ID inclusive),
compress + QR-page ms. One real-device run recorded in the PR description.
This also answers whether the pinned Rust crate already caches SRS
(second-call delta).

### 1. Warm prover — passport-noir binding cache + explicit warmup

Rust side (mopro binding, sibling repo):

- Cache keyed by `(circuitPath, srsPath)`: parsed circuit + barretenberg
  setup + SRS handle live in a `static` map after first use; subsequent
  prove/verify reuse them. Invalidation by path identity is sufficient —
  assets are immutable per release (SHA-pinned).
- SRS access via mmap rather than heap copy, so resident cost is OS page
  cache, reclaimable under pressure.
- New exported fn `warmup_circuit(circuit_path, srs_path)` that builds the
  cache entry and returns timing.

Nitro side (`nitro-modules/passport-zk`):

- Spec gains `warmupCircuit(circuitPath: string, srsPath?: string):
  Promise<number>` (returns warmup ms), implemented on both platforms with
  the same alias resolution as `generateNoirProof`.
- On iOS, release-on-memory-warning is left to mmap/OS; no explicit eviction
  API in v1.

Lands as a passport-noir release + xcframework/SRS pin bump through the
existing CI flow (SHA-pinned `passport.srs.bin` asset + seed-first
`Package.resolved`).

### 2. Background prepare — credential saves first, proofs follow

New enrollment lifecycle:

```
NFC read (witness built during read, as today)
  → Face ID once: requireBiometric('passportSave')   ← the CLAUDE.md-mandated
  → persist credential immediately, proof state = 'pending'
  → background task: warmup → prove dsc_chain → prove passport_adapter
  → on success: attach proofPayload, set trust L3/L3+ (per AA mode), notify
  → on failure: proof state = 'failed', retry affordance on the credential
```

- **`openac_show` leaves the prepare bundle.** The proof payload's
  `phases.show` slot becomes optional/null; the vk self-pin is produced via
  `getNoirVerificationKey('openac_show')` in the background task instead of
  a full prove+verify. A compatibility sweep covers every consumer of
  `phases.show.openAcShow` / the bundled show proof (scan-side enrollment
  envelope handling, credential detail, parity fixtures).
- **No device signature at prepare.** `bindPassportOpenAcV3DeviceSignature`
  only patches the `openac_show` witness (`openacV3.ts:633-645`); with show
  out of prepare, enrollment needs no `'sign'` gate at all. The single
  enrollment Face ID is the `passportSave` gate above (currently mandated by
  CLAUDE.md but unwired).
- **Task state machine persisted in MMKV**: `pending → proving → done |
  failed`, keyed by credential id. On app launch, a pending/proving entry
  resumes (witness is vaulted; proving is idempotent). Proving runs while
  the app is alive; no BGProcessingTask in v1 — death mid-prove just resumes
  next launch.
- **Show works immediately.** The show envelope carries only the fresh
  `openac_show` proof, so presentations are valid while prepare proofs are
  still pending; holder-side trust display stays `pending` until upgrade.
- On-device verifies of the prepare proofs run once in the background task
  (cheap to keep off the UX path); per-circuit verify stays as the
  correctness check it is today.

### 3. Show fast path

- **Prefetch on sheet open** (`PresentationSheet`), all in parallel:
  witness vault decrypt, `loadPassportNitroModules()`,
  `warmupCircuit('openac_show')`. By the time the user has picked claims,
  the prover is hot.
- **Time-bucket pre-prove.** Bucket nonces are derivable
  (`derivePassportShowBucketNonceHash`). On sheet open: one Face ID
  (`'sign'`), then within the 5-min grace sign the current bucket nonce and
  prove in the background; cache the result keyed by
  `(credentialId, bucket, claims selection)`. Tapping present renders the QR
  from cache; crossing a bucket boundary re-proves silently. Challenge mode
  still proves after the scan (nonce unknowable), but against a warm prover:
  target ≤2 s.
- **Self-verify behind a dev flag.** The post-prove `verifyNoirProof`
  (`showPresentation.ts:316-319`) runs only in dev builds; the verifier
  device verifies for real anyway.
- **vk leaves the envelope.** Envelope v2 carries proof + public inputs +
  vk pin (sha256) only. The verifier derives the `openac_show` vk locally
  once via `getNoirVerificationKey` (both sides run the same app/build),
  caches it, and checks the pin exactly as today. Envelope shrinks ~2–3 KB
  → fewer `sqc1` frames → faster scan loop. Schema bumps to
  `…show-presentation.v2`; the verifier accepts v1 (embedded vk + pin check)
  for one release window.

> **2026-06-13 device baseline (after phases 1–2):** prepare ≈ 15 s,
> show > 10 s. Show runs the smallest circuit, so per-call fixed cost
> (SRS read + barretenberg setup) dominates — phase 3 (warm prover) is
> confirmed as the critical lever. Phase 4 is pulled forward ahead of
> phase 3 (Face ID friction blocks silent show), with an AGGRESSIVE gate
> policy chosen by the owner: only destructive/recovery actions
> (delete, rotateMasterKey, revealRecoveryBundle, deleteZKIdentity)
> always prompt; everything else (sign, present, export, exchange,
> passportSave) shares ONE 5-minute grace bucket.

### 4. Single Face ID

- `spruce-did` exposes key auth metadata: `keyAuthMode(alias): 'none' |
  'native-acl' | 'js-gated'` (iOS: SE key with `.userPresence` vs syncable;
  Android: auth-bound vs not).
- For `native-acl` keys, the native module owns the gate: a shared
  `LAContext` with `touchIDAuthenticationAllowableReuseDuration` aligned to
  the JS grace (≤5 min), passed via `kSecUseAuthenticationContext` on the
  key query, so repeated signs within the window don't re-prompt. JS
  (`signDigestWithCurrentKey`) skips `requireBiometric('sign')` when the
  driver reports `native-acl` — the system prompt is the one prompt.
- For syncable/`js-gated` keys, behavior is unchanged (JS prompt + grace).
- Net per flow: enrollment = one `passportSave` prompt; show = one `'sign'`
  prompt whose grace covers pre-prove signing and bucket rollover within the
  session.

### 5. Real progress UI

- `CryptoCompilingOverlay` becomes event-driven: phases map 1:1 to real
  milestones (witness ready → per-circuit generate/verify from the existing
  `onProgress` — `openacV3.ts:655,662` — → done). The terminal-aesthetic
  hash scroll may stay as decoration while a circuit is actually proving,
  but "[ VERIFIED ]" renders only on real completion, and the overlay
  dismisses on the real promise, not a timer.
- With background prepare, the enrollment overlay largely disappears; the
  pending/proving/failed state renders on the credential card (real states,
  rule-8 compliant).
- Show keeps its message-driven inline progress; after the fast path it
  should rarely exceed one visible state.

## Compatibility / sweeps

- Audit all consumers of `phases.show.openAcShow` and of the enrollment
  envelope's show proof before making the slot optional.
- Parity fixtures (`packages/parity-fixtures`, `__tests__/parity`) updated
  for the payload schema change and envelope v2.
- Legacy SE keys are NOT rotated (rotation changes the DID); they keep
  working via the native-gate path indefinitely.
- Android mirrors each step (asset extraction already idempotent; warmup +
  cache + keystore auth metadata implemented in the Kotlin module).

## Risks

| Risk | Mitigation |
|---|---|
| 128 MB SRS resident → jetsam on old devices | mmap, OS-reclaimable; measure RSS in instrumentation PR |
| Rust cache returns stale artifacts across pin bumps | cache key = resolved absolute path; assets immutable per release |
| App killed mid-background-prove | persisted task state, resume on launch; proving idempotent from vaulted witness |
| Pre-proved bucket presentation leaks staleness | cache keyed by bucket + claims; bucket window already enforced verifier-side (±skew) |
| Envelope v2 vs old verifier builds | verifier accepts v1+v2 for one release window; vk pin check identical |
| LAContext reuse weakens gating | reuse window ≤ JS grace (5 min), same threat model as today's grace |

## Testing

- Unit: prepare task state machine (pending/resume/failure), claims→bucket
  cache keying, envelope v2 build/parse, `keyAuthMode` gating logic,
  vk-from-`getNoirVerificationKey` pin parity with vk-from-prove.
- Parity: payload schema + envelope fixtures regenerated; Swift↔Expo parity
  suites stay green.
- Device: instrumentation log run before/after each phase, attached to PRs;
  acceptance table at top is the gate.

## Phasing (PR order)

1. Instrumentation + device baseline (no behavior change).
2. App-layer trims: drop enrollment `openac_show` prove+verify (vk via
   `getNoirVerificationKey`), dev-flag the show self-verify, prefetch on
   sheet open, real-progress overlay. Wire `requireBiometric('passportSave')`
   at persist in this same PR — dropping the show proof removes the `'sign'`
   prompt from prepare, and enrollment must not be left without a Face ID
   gate in the interim.
3. passport-noir cache + `warmupCircuit` (pin bump), wire warmup calls.
4. Single Face ID (`keyAuthMode` + native LAContext gate).
5. Background prepare (lifecycle + pending UI + resume).
6. Time-bucket pre-prove + envelope v2 (vk removal).
