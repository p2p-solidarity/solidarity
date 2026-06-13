# Face ID Single Gate (Phase 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One Face ID prompt per user intent: a shared 5-minute grace bucket across the sign/present/export/exchange/passportSave family (only destructive actions always prompt), native double-prompt eliminated via `keyAuthMode` detection + iOS LAContext reuse, and the vault wrapping key migrated off its `.userPresence` ACL.

**Architecture (aggressive policy, owner-approved):**
- `biometric.ts` becomes the single grace authority: ONE shared bucket; `'delete'` is the only always-prompt reason. `biometricGatekeeper` rides the same bucket (always-prompt actions: `rotateMasterKey`, `revealRecoveryBundle`, `deleteZKIdentity`).
- spruce-did gains `keyAuthMode(alias)`: iOS probes with an `interactionNotAllowed` LAContext (cached per alias); Android reads `KeyInfo.isUserAuthenticationRequired`. `signingKey.ts` skips the JS prompt for `native-acl` keys; iOS real signs attach a shared LAContext with `touchIDAuthenticationAllowableReuseDuration` so native prompts also honor the 5-min window.
- secrets-vault root-secret envelope migrates from the v1 (possibly ACL'd) wrapping key to an ACL-free v2 key — detected by envelope `keyAlias`, no keychain introspection.
- `signingKeyPolicy` stops requesting native biometric binding for NEW keys (JS gate is canonical; Android per-op auth-bound keys cannot sign without a CryptoObject prompt — pre-existing latent break).

**Tech Stack:** Expo TS + bun:test; nitro modules spruce-did/secrets-vault (Swift + Kotlin + nitrogen codegen, generated code committed).

**Out of scope (noted follow-ups):** Android CryptoObject BiometricPrompt for EXISTING auth-bound keys (pre-existing break, separate pass); AppState-driven grace reset.

---

### Task 1: Shared grace bucket in `biometric.ts`

**Files:** Modify `src/keychain/biometric.ts`; update `__tests__/unit/biometricGate.test.ts`, `__tests__/unit/biometricCoalescing.test.ts`.

- [ ] Step 1 (red): update the two test files to the new contract: (a) every reason still prompts with its distinct non-empty message on a COLD bucket; (b) a successful auth for ANY reason except `'delete'` arms the shared grace — a subsequent call with any OTHER non-delete reason within 5 min resolves `true` with NO `authenticateAsync` call; (c) `'delete'` prompts even with grace armed, and its success does NOT arm the bucket; (d) failed auth never arms; (e) in-flight coalescing applies to all graced reasons (concurrent calls share one prompt); (f) `resetBiometricGrace()` clears the bucket; (g) new exports `armBiometricGrace()` / `hasBiometricGrace()` behave accordingly.
- [ ] Step 2: implement — replace `signGraceUntil`/`signPromptInFlight` with bucket-wide `graceUntil`/`promptInFlight`; `const ALWAYS_PROMPT: ReadonlySet<BiometricReason> = new Set(['delete'])`; export `armBiometricGrace()` (sets `graceUntil = Date.now() + GRACE_MS`) and `hasBiometricGrace()`; successful `authenticate()` for non-delete reasons arms. Keep `resetBiometricGrace()` name.
- [ ] Step 3: `bun test __tests__/unit/biometricGate.test.ts __tests__/unit/biometricCoalescing.test.ts` green; typecheck; commit `feat(keychain): shared biometric grace bucket (delete always prompts)`.

### Task 2: Gatekeeper rides the shared bucket

**Files:** Modify `src/keychain/biometricGatekeeper.ts`; extend `__tests__/unit/biometricGate.test.ts` (or the file covering the gatekeeper).

- [ ] Step 1 (red): tests: (a) `requireSensitiveAction('presentProof', …)` with grace armed returns `{success: true, method: 'biometric'}` without prompting; (b) success of a graced action arms the shared bucket (subsequent `requireBiometric('sign')` silent); (c) `rotateMasterKey` / `revealRecoveryBundle` / `deleteZKIdentity` prompt even with grace and don't arm; (d) policy-disabled short-circuit unchanged.
- [ ] Step 2: implement — `const ALWAYS_PROMPT_ACTIONS: ReadonlySet<SensitiveAction> = new Set(['rotateMasterKey', 'revealRecoveryBundle', 'deleteZKIdentity'])`; for other actions check `hasBiometricGrace()` before prompting and `armBiometricGrace()` on success (import from `./biometric`).
- [ ] Step 3: tests green; typecheck; commit `feat(keychain): sensitive-action gatekeeper shares the biometric grace bucket`.

### Task 3: Vault wrapping key → ACL-free v2

**Files:** Modify `src/vault/secretsKeychain.ts`; extend `__tests__/unit/secretsKeychain.test.ts`.

- [ ] Step 1 (red): with a stub vault driver, tests: (a) fresh root in biometric mode wraps via `ensureWrappingKey(V2, /*requireBiometric*/ false)` and envelope `keyAlias` is the v2 alias; (b) an existing v1 envelope unwraps, is re-wrapped under v2, envelope rewritten, `deleteKey(v1)` attempted (failure swallowed); (c) silent mode performs NO migration; (d) migration failure leaves the old envelope intact and still returns the root.
- [ ] Step 2: implement — `WRAPPING_KEY_ALIAS_V2 = 'gg.solidarity.vault.rootSecret.wrapping.v2'`; `wrapRoot(bytes)` drops its `requireBio` parameter and always provisions v2 with `requireBiometric: false` (JS `requireBiometric('exchange')` — now grace-aware — is the gate; the SE key keeps `.privateKeyUsage` non-extractability). In `getOrCreateRootSecret` biometric-mode success path: if `stored.kind === 'v1.hw' && stored.keyAlias === WRAPPING_KEY_ALIAS` → rewrap+rewrite+best-effort delete, all inside try/catch that falls back to the unwrapped root.
- [ ] Step 3: tests green; typecheck; commit `feat(vault): migrate root wrapping key to ACL-free v2 (JS gate is canonical)`.

### Task 4: spruce-did `keyAuthMode` + iOS LAContext reuse

**Files:** Modify `nitro-modules/spruce-did/src/specs/SpruceDid.nitro.ts`, `ios/HybridSpruceDid.swift`, `ios/SpruceDidKeyStore.swift`, `android/.../HybridSpruceDid.kt`; run `bun run nitrogen` in the module; commit generated code.

- [ ] Step 1: spec — add to the interface:
  ```ts
  /**
   * How signing with this alias is biometric-gated. 'native-acl' = the OS
   * prompts inside the keychain/keystore operation itself (legacy SE key
   * with .userPresence; Android auth-bound key) — the JS layer must NOT
   * stack its own prompt. 'js-gated' = no native gate; JS prompts.
   */
  keyAuthMode(alias: string): Promise<string>;
  ```
- [ ] Step 2: `bun run nitrogen` in `nitro-modules/spruce-did`; confirm generated diffs compile-shape (Swift protocol + Kotlin abstract method).
- [ ] Step 3: iOS — `SpruceDidKeyStore.fetchECPrivateKey(alias:context:)` overload attaching `kSecUseAuthenticationContext`. `HybridSpruceDid`:
  - static probe cache `[String: String]`;
  - `keyAuthMode`: fetch key with a probe `LAContext` (`interactionNotAllowed = true`), `SecKeyCreateSignature` over 32 random bytes; error containing "interaction"/"Interaction" or `errSecInteractionNotAllowed` → `'native-acl'`; success or any other error → `'js-gated'` (fail-safe: worst case keeps today's double prompt). Discard the probe signature.
  - shared sign `LAContext` (lazily created, `touchIDAuthenticationAllowableReuseDuration = min(300, LATouchIDAuthenticationMaximumAllowableReuseDuration)`), attached in `signJws`/`signRawP256` key fetches so repeated native prompts within the window are silent.
- [ ] Step 4: Android — `keyAuthMode` via `KeyFactory.getKeySpec(privateKey, KeyInfo::class.java).isUserAuthenticationRequired` → `'native-acl'` else `'js-gated'`; ed25519 generic-password aliases → `'js-gated'`.
- [ ] Step 5: commit `feat(spruce-did): expose keyAuthMode + iOS LAContext reuse window`.

### Task 5: `signingKey.ts` skips JS gate for native-acl keys; policy stops native binding

**Files:** Modify `src/keychain/signingKey.ts`, `src/keychain/signingKeyPolicy.ts`; update `__tests__/unit/signingKeyPolicy.test.ts`, extend the spruce-did JS-wiring test (test driver gains `keyAuthMode`).

- [ ] Step 1 (red): tests: (a) when the test driver reports `'native-acl'`, `signRawEs256`/`signJwt` do NOT call `authenticateAsync` and still sign; (b) `'js-gated'` keeps the JS prompt; (c) driver missing `keyAuthMode` (older binary) → treated as `'js-gated'`; (d) `shouldRequireNativeBiometricBinding(true)` now returns `false` (JS gate canonical — native per-op binding breaks Android signing).
- [ ] Step 2: implement — cache `keyAuthMode` alongside `cachedIdentity` (resolved once per process after `ensureSigningKey`, via `'keyAuthMode' in driver ? await driver.keyAuthMode(alias) : 'js-gated'`, errors → `'js-gated'`); `signJwt`/`signDigestWithCurrentKey` call `requireBiometric('sign')` only when mode is `'js-gated'`; `shouldRequireNativeBiometricBinding` returns `false` with the rationale comment.
- [ ] Step 3: tests green; typecheck; commit `feat(keychain): single-layer sign gate via keyAuthMode`.

### Task 6: Verification

- [ ] `bun run typecheck`; full `bun test` — no NEW failures vs the 40-fail/2-error baseline; lint touched files clean.
- [ ] Manual (user device): show twice within 5 min → exactly ONE system prompt total; OID4VP present → 1 prompt; vault unlock → 1 prompt (and after the one-time migration unlock, no native second prompt ever again); delete/export per policy (export now rides grace); enrollment save → 1 prompt.
- [ ] Update plan checkboxes; record results.
