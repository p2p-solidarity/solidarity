# Cross-Device Root Identity and Backup Restore Implementation Plan

> **Status:** Draft — `grill-me` / `grilling` in progress. Do not implement until every blocking grill decision is resolved in this file and the owner approves the plan.
>
> **Source:** Continuation of Claude session `4c91c43b-2381-461e-97f2-b4b4394ae631` (2026-07-16). The session completed diagnosis and added two uncommitted characterization tests, then hit its session limit while entering plan mode.
>
> **Process:** Security-sensitive keychain, identity, and backup work is size **L** under `flow`: approve this plan only after adversarial grilling; implement crypto/derivation seams with red-green TDD; run code review and the full airmeishi verification gate before claiming completion.

**Goal:** A user who protects their identity with iCloud Keychain or a Recovery Phrase can restore the same Root Identity, retain the same active Signing Identity, and decrypt a newly-created Backup Archive proven to have reached cloud storage on another device, without changing or exporting the Device Storage Key.

**Architecture (recommended; not yet approved):** Keep the Device Storage Key device-local for MMKV and local record encryption. Derive a separate 32-byte Portable Backup Key from the Recovery Phrase under a pinned HKDF domain, mark new archives as SOLB v2, and recover the Root Identity before attempting archive decryption. Recover the existing Signing Identity non-destructively before allowing explicit fresh generation. Make the native file writer return `iCloud`, `googleDrive`, or `local-only`, and never describe `local-only` as cross-device. Continue reading SOLB v1 with the legacy Device Storage Key on the original device, but never create another non-portable v1 archive as a silent fallback.

**Tech stack:** Expo / React Native / TypeScript, Bun tests, `@scure/bip39`, HKDF-SHA256, AES-256-GCM, Nitro Secrets Vault, Nitro CloudKit / Google Drive.

---

## 1. Decisions already locked

The source session contains one explicit product decision:

- Fix both confirmed gaps together:
  1. Root Identity iCloud backup is write-only at the app layer.
  2. Backup Archives are encrypted with a Device Storage Key that a second device does not possess.

The first grill decision is also resolved:

- **G1 accepted (2026-07-16):** fix the delayed-sync race for the currently active Signing Identity in the same implementation. Cross-device success must preserve both the additive Root Identity and the Signing Identity used by current credential/presentation flows.
- **G2 accepted (2026-07-16):** cross-device completion requires the native archive writer to report its actual target. A `local-only` write may be retained as a protected local archive, but it is not a successful cloud backup and must not produce cloud-success copy or state.
- **G3 accepted (2026-07-16):** derive the Portable Backup Key from the Recovery Phrase with a purpose-separated HKDF domain; do not synchronize another random AES key. Decision record: `docs/adr/0001-derive-portable-backup-key-from-recovery-phrase.md`.

The following constraints are also fixed by the existing code and repo rules:

- `src/storage/secureMasterKey.ts` remains the source of the **Device Storage Key**.
- The Device Storage Key continues to protect MMKV, local encrypted records, vault data, and other existing local callers. Its semantics must not change.
- Recovery Phrase plaintext must never enter MMKV, logs, analytics, error reports, or the Backup Archive.
- `packages/parity-fixtures/` remains frozen and must not be edited or regenerated.
- A missing or delayed cloud key is not proof that the user is new. The app must not silently mint a replacement identity during a recovery attempt.
- A backup operation must not report cross-device success when it wrote only a device-local archive or used a device-local encryption key.

## 2. Canonical language and current key inventory

The repository-level glossary is in `../../../../../CONTEXT.md`. This plan uses these terms consistently:

| Canonical term | Current implementation | Purpose | Portable today? |
|---|---|---|---|
| **Device Storage Key** | `gg.solidarity.master.v2` in `src/storage/secureMasterKey.ts` | MMKV and local-data encryption; currently also encrypts Backup Archives | No |
| **Recovery Phrase** | `gg.solidarity.rootkey.mnemonic.v1` in `src/identity/rootKey.ts` | Determines the Root Identity | Local copy: no; iCloud copy: written but not read |
| **Root Identity** | mnemonic-derived P-256 `did:key` in `src/identity/rootKey.ts` | App/Web portable identity | Intended to be portable, but fresh-device read-back is absent |
| **Signing Identity** | `solidarity.master.v2` in `src/keychain/signingKey.ts` / spruce-did | Signs the app's current credentials and presentations | iOS syncable for new installs, but provisioning races sync |
| **Portable Backup Key** | Implementation pending | Recovery-Phrase-derived key used only for SOLB v2 Backup Archives | Design approved via G3 |

The Device Storage Key and Signing Identity have similar aliases but are unrelated secrets. No task may call either one “the master key” without the canonical qualifier.

## 3. Confirmed evidence

### 3.1 Root Identity is written to iCloud but never restored

- `src/identity/rootKey.ts:135-138` defines `RootKeySyncStorage` with only `setSyncedMnemonic` and `deleteSyncedMnemonic`.
- `src/identity/rootKey.ts:147-153` narrows the lazy Secrets Vault surface to set/delete even though the native interface already supports read.
- `nitro-modules/secrets-vault/src/specs/SecretsVault.nitro.ts:105-112` and `ios/HybridSecretsVault.swift:210-233` already implement `getSynchronizableItem`.
- `src/onboarding/steps/BackupStep.tsx:98-121` checks only the local Root Identity; if absent, it immediately creates a new Recovery Phrase.

Result: a fresh device can have the correct Recovery Phrase in iCloud Keychain while the app declares itself unprovisioned and creates a different Root Identity.

### 3.2 Backup Archives are sealed with a device-local secret

- `src/backup/cloudProvider.ts:172-193` routes upload/download through the default `encryptJson` / `decryptJson` functions.
- `src/storage/encryptionManager.ts:44-68` always obtains `getMasterKey()`.
- `src/storage/secureMasterKey.ts:53-56` stores that key without a synchronizable attribute.
- `src/storage/mmkv.ts:45-46` and `src/storage/mmkvConfig.ts:11-18` also depend on the same key, so changing its derivation would strand existing local data.

Result: Device B generates a different Device Storage Key and cannot authenticate Device A's AES-GCM ciphertext.

### 3.3 Onboarding currently runs restore before Root Identity setup

- `src/onboarding/state.ts:49-57` orders `secureKeys` before `backup`.
- `SecureKeysStep.tsx:83-90` creates/loads the Signing Identity, then offers data restore.
- `BackupStep.tsx` does not provision or recover the Root Identity until the following step.

Result: the current restore site cannot derive a Portable Backup Key without hiding recovery side effects inside the backup layer.

### 3.4 Adjacent blockers can still make “cross-device” false

These were found while validating the source session:

- **Signing Identity race — now in scope via G1:** `ensureSigningKey()` treats a momentary `hasKey() === false` as permission to generate. `SpruceDidKeyStore.generateSyncableP256Key` deletes every matching sync state before adding a new key (`ios/SpruceDidKeyStore.swift:112-120`, `311-320`). A delayed iCloud Keychain item can therefore be replaced.
- **Local archive fallback — now in scope via G2:** `HybridCloudKit+FileBackup.swift:32-51` silently selects local Documents when the iCloud ubiquity container is unavailable, while `writeFileBackup` returns only `void`. The UI cannot truthfully distinguish “cloud archive” from “local-only archive.”

G1 requires continuity of the active Signing Identity. G2 requires an attested cloud target before the product can claim that a Backup Archive is available on another device.

## 4. Cryptographic design

### 4.1 Derive one purpose-specific Portable Backup Key

**Approved by G3.**

Add a fixed derivation to `packages/shared/src/derive.ts`:

```text
seed     = BIP39.mnemonicToSeedSync(normalizedRecoveryPhrase)
K_backup = HKDF-SHA256(
  ikm  = seed,
  salt = UTF8("solidarity"),
  info = UTF8("solidarity-backup-v1"),
  L    = 32
)
```

Rules:

- Validate the BIP-39 checksum before deriving.
- Do not reduce the output modulo a curve order; this is a 32-byte AES key, not a signing scalar.
- Keep `HKDF_INFO_ROOT`, `HKDF_INFO_NOSTR`, and `HKDF_INFO_BACKUP` distinct.
- Freeze these non-secret conformance vectors in `packages/shared/vectors/derive.json`:
  - `legal winner … yellow` → `0b3d69a14fcec6046218fe3c889f61206f64e6e0271aad1723e42cdad6653c70`
  - `zoo zoo … wrong` → `a1724948ce15da6b523632e449a9767d7f43cff40d06e6fc0af26bb77e58821f`
- AES-GCM continues to generate a fresh random 96-bit nonce for every archive. Reusing the derived key across archives is acceptable only with that nonce invariant pinned by tests.

### 4.2 Keep Recovery Phrase ownership inside the identity module

The backup layer must never receive or return the Recovery Phrase. Deepen `rootKey.ts` behind this proposed interface:

```ts
export type RootKeyRecovery =
  | { readonly kind: 'alreadyLocal'; readonly did: string }
  | { readonly kind: 'restoredFromICloud'; readonly did: string }
  | { readonly kind: 'notFound' };

export async function restoreRootKeyFromICloud(): Promise<
  Result<RootKeyRecovery, RootKeyError>
>;

export async function getPortableBackupKey(): Promise<
  Result<Uint8Array, RootKeyError>
>;
```

Interface invariants:

- A valid local Root Identity always wins. The restore function never replaces an existing local Recovery Phrase.
- The iCloud value is normalized and checksum-validated before local persistence.
- Empty native strings map to `ok({kind: 'notFound'})`; transport/keychain failures map to a tagged error.
- A malformed synced phrase is an error. It never falls through to fresh identity creation.
- `getPortableBackupKey()` reads the local Recovery Phrase while the device is unlocked and returns only the derived 32 bytes. Background backup does not reveal the phrase and does not display a biometric prompt.
- Tests use the existing internal storage adapters. No new production-facing storage port is introduced solely for tests.

### 4.3 Make the archive format identify its key scheme

Do not write two key schemes under the same undecorated SOLB version and “try keys until one works.” Change `solbEnvelope.ts` to return a discriminated value:

```ts
export type DecodedSolb =
  | { readonly version: 1; readonly keyScheme: 'device-storage-v1'; readonly ciphertextB64: string }
  | { readonly version: 2; readonly keyScheme: 'recovery-phrase-hkdf-v1'; readonly ciphertextB64: string };
```

- **SOLB v1 reader:** existing Swift/Expo archive; decrypt only with the Device Storage Key.
- **SOLB v2 writer/reader:** new portable archive; encrypt/decrypt only with the Portable Backup Key.
- New writes require a Root Identity. They must return a typed `root-key-unavailable` outcome rather than silently writing another v1 archive.
- Continue rejecting plaintext legacy files.
- Unknown versions fail closed.

The writer is no longer byte-compatible with the deleted Swift app, but the reader remains compatible with existing Swift v1 archives. Update comments and tests to say “v1-reader compatible,” not “all writes are byte-identical.”

### 4.4 Preserve local encryption semantics

Add explicit-key helpers without changing existing callers:

```ts
encryptJsonWithKey(key: Uint8Array, value: unknown): Promise<string>
decryptJsonWithKey<T>(key: Uint8Array, blob: string): Promise<T>
```

`encryptJson` and `decryptJson` continue to call `getMasterKey()` and delegate to the explicit-key helpers. Only the Backup Archive path uses the explicit Portable Backup Key.

### 4.5 Recovery must precede archive restore

Recommended onboarding sequence:

```text
welcome
  -> recover/provision Root Identity
       local Root Identity? use it
       else iOS: poll iCloud read for a bounded window
       else show explicit choices:
            Retry iCloud sync
            Enter Recovery Phrase
            Start Fresh (destructive acknowledgement)
  -> probe and optionally restore Backup Archive
  -> recover/provision Signing Identity
  -> page -> connect -> share -> complete
```

Move the archive restore responsibility out of `SecureKeysStep` and into the Root Identity / backup step, or reorder the existing steps so the Root Identity is guaranteed before `restoreFromBackup()` runs. Do not make `restoreFromBackup()` silently create/import identities: recovery is a product decision with UI states, while archive decryption is a data operation.

On Android, “Enter Recovery Phrase” is the cross-device recovery path. Android must not offer or call iCloud Keychain.

## 5. Migration and failure matrix

| Archive / device state | Expected behavior |
|---|---|
| v1 archive, original device still has Device Storage Key | Restore with the v1 key path |
| v1 Swift archive, same upgraded iPhone, legacy key recoverable | Recover legacy Device Storage Key, then restore |
| v1 archive, different device without original Device Storage Key | Cannot be made decryptable retroactively; show a precise legacy-key-unavailable error |
| Updated device with local Root Identity | Create and read back a v2 archive before calling the migration successful |
| v2 archive, fresh iOS device, Recovery Phrase synced | Restore Root Identity locally, derive identical Portable Backup Key, restore data |
| v2 archive, iCloud Keychain delayed or disabled | Do not mint automatically; show retry / Recovery Phrase / explicit Start Fresh |
| v2 archive, fresh Android device with Recovery Phrase | Import phrase before Drive restore; derive identical key and restore |
| v2 archive, wrong Recovery Phrase | AES-GCM authentication fails; report wrong identity or corrupt archive without leaking details |
| Recovery Phrase intentionally changed | Old v2 archives remain tied to the old phrase; create and verify a new v2 archive before retiring the old recovery route |
| Newest archive unreadable but an older archive may work | Never roll data back silently; expose the date/version and require an explicit older-backup choice if that feature is approved in grilling |
| iOS file writer fell back to local Documents | Mark result `local-only`; never display “synced across devices” |

An update cannot rescue an existing v1 archive after the original Device Storage Key is already lost. Release notes and UI must state that the user needs to open the updated app on the old device once and create a verified v2 archive.

## 6. Error model

Extend tagged backup outcomes so UI copy is actionable:

- `root-key-unavailable`: no local Recovery Phrase is available for a new portable write.
- `root-key-not-synced-yet`: iCloud read returned no value during a recovery attempt; retry/import/start-fresh are available.
- `legacy-key-unavailable`: a SOLB v1 archive cannot be opened on this device.
- `portable-key-mismatch`: SOLB v2 authentication failed with the active Root Identity.
- `unsupported-version`: the archive version is unknown.
- `local-only`: write succeeded only to local Documents and is not cross-device.
- `unreadable`: transport, framing, JSON, or other I/O failure.

Do not log aliases, Recovery Phrases, derived keys, ciphertext, DIDs tied to a failure, or decrypted record content. Error reports may include only the tag, platform, archive version, provider, and coarse operation stage.

## 7. File responsibilities

### Always in scope for the selected two fixes

- `packages/shared/src/derive.ts` — fixed Portable Backup Key derivation.
- `packages/shared/test/derive.test.ts` — derivation determinism, separation, invalid phrase, and frozen vector tests.
- `packages/shared/vectors/derive.json` — add the two public backup-key outputs.
- `apps/expo/src/identity/rootKey.ts` — iCloud read-back, local-wins recovery, and key derivation interface.
- `apps/expo/src/identity/index.ts` — export production recovery/key functions; keep test adapters private.
- `apps/expo/src/storage/encryptionManager.ts` — explicit-key JSON encryption/decryption while preserving defaults.
- `apps/expo/src/backup/solbEnvelope.ts` — discriminated v1/v2 archive framing.
- `apps/expo/src/backup/cloudProvider.ts` — v2 writes, version-directed key resolution, v1 reads.
- `apps/expo/src/backup/backupManager.ts` and `src/backup/index.ts` — typed outcomes and orchestration.
- `apps/expo/src/onboarding/state.ts` — recovery-before-restore order.
- `apps/expo/src/onboarding/steps/BackupStep.tsx` and `backupStepLogic.ts` — recovery/provision/import/retry/start-fresh states.
- `apps/expo/src/onboarding/steps/SecureKeysStep.tsx` — remove archive restore responsibility.
- `apps/expo/app/settings/backup.tsx` — portable-key and migration errors/actions.
- `apps/expo/app/settings/identity-export.tsx` — make identity switching invalidate stale sync claims and explain backup consequences.
- `apps/expo/src/i18n/locales/en.json` and `zh-Hant.json` — all new recovery/migration states.
- `apps/expo/src/keychain/signingKey.ts` — separate non-destructive recovery from explicit fresh Signing Identity generation.
- `nitro-modules/spruce-did/ios/SpruceDidKeyStore.swift` — remove delete-before-generate behavior and resolve syncable keys deterministically.
- `apps/expo/__tests__/parity/spruceDid.parity.test.ts` and Signing Identity policy tests — delayed-sync, existing-key, explicit-create, and no-delete coverage.
- `nitro-modules/cloudkit/src/specs/CloudKit.nitro.ts` and generated Nitrogen files — return the actual archive target from `writeFileBackup`.
- `nitro-modules/cloudkit/ios/HybridCloudKit+FileBackup.swift` — distinguish iCloud ubiquity storage from local fallback in the result.
- `nitro-modules/cloudkit/android/src/main/java/com/margelo/nitro/gg/solidarity/cloudkit/HybridCloudKit.kt` — report `googleDrive` after a successful Drive write.
- Cloud backup native/JS tests — pin `iCloud`, `googleDrive`, and `local-only` behavior.

### Existing characterization tests to convert, not discard

- `apps/expo/__tests__/unit/rootKeyCrossDeviceRestore.test.ts` — currently proves the broken write-only behavior; flip it to require Device B to recover the same Root Identity.
- `apps/expo/__tests__/unit/backupMasterKeyPortability.test.ts` — currently proves different Device Storage Keys fail; convert it to prove identical Recovery Phrases restore across independent devices and different phrases fail.

### Existing regression tests to extend

- `__tests__/unit/rootKey.test.ts`
- `__tests__/unit/backupStepLogic.test.ts`
- `__tests__/unit/solbEnvelope.test.ts`
- `__tests__/unit/icloudBackupRoundtrip.test.ts`
- `__tests__/unit/backupPolicy.test.ts`
- `__tests__/unit/i18nCatalog.test.ts`
- `packages/shared/test/derive.test.ts`

## 8. TDD implementation slices

### Task 1: Pin Portable Backup Key derivation

- [ ] Add failing shared-package tests for the exact HKDF equation, 32-byte output, domain separation, invalid checksum, and both frozen hex vectors.
- [ ] Implement `HKDF_INFO_BACKUP` and `deriveBackupEncryptionKey(mnemonic)` without curve reduction.
- [ ] Run `bun test packages/shared/test/derive.test.ts` from the repo root; expected PASS.
- [ ] Commit the pure derivation slice independently.

### Task 2: Add Root Identity iCloud read-back

- [ ] Change `rootKeyCrossDeviceRestore.test.ts` from a green gap demonstration to a failing desired-behavior test.
- [ ] Extend `RootKeySyncStorage` with `getSyncedMnemonic` and wire the already-existing native `getSynchronizableItem`.
- [ ] Implement local-wins `restoreRootKeyFromICloud()` and `getPortableBackupKey()`.
- [ ] Cover missing value, malformed phrase, keychain error, local storage failure, existing-local no-overwrite, and Device A → Device B same-DID recovery.
- [ ] Change the iOS synchronizable writer from delete-then-add to update-or-add so a failed replacement cannot destroy the last good synced phrase; verify on a real iOS device.
- [ ] Run the focused root-key tests and typecheck; expected PASS.

### Task 3: Add explicit-key crypto and SOLB v2

- [ ] Add failing tests that `encryptJsonWithKey` round-trips Sets/Maps exactly like the existing default and throws `DecryptError` on a wrong key.
- [ ] Make existing `encryptJson` / `decryptJson` delegate without changing any non-backup caller.
- [ ] Change envelope tests to cover v1 decode, v2 encode/decode, unknown version, plaintext refusal, and version discrimination.
- [ ] Implement the discriminated envelope; never infer key scheme by trial decryption.
- [ ] Run encryption parity and envelope tests; expected PASS with v1 reader compatibility intact.

### Task 4: Make cloud archives portable and migrate honestly

- [ ] Change the portability characterization test to fail until two devices with different Device Storage Keys but the same Recovery Phrase can open v2.
- [ ] Write v2 only with the Portable Backup Key; return `root-key-unavailable` instead of falling back to v1.
- [ ] Read v1 only with the Device Storage Key and v2 only with the Portable Backup Key.
- [ ] Extend `icloudBackupRoundtrip.test.ts` to model Device A and Device B separately; remove the false “fresh install” test that reused one fixed key.
- [ ] Cover v1 same-device success, v1 cross-device honest failure, v2 cross-device success, wrong phrase failure, corrupt file failure, and mixed v1/v2 newest selection.
- [ ] After update, create a v2 migration archive and verify it can be read before reporting the backup portable.
- [ ] Do not silently select an older archive when the newest fails.

### Task 5: Put recovery before restore

- [ ] Add failing pure state/decision tests for local root, synced root, delayed sync, manual phrase, explicit start-fresh, Android, and replay.
- [ ] Reorder onboarding or move restore ownership so Root Identity recovery completes before archive restore.
- [ ] Remove `probeLatestBackup` / `restoreFromBackup` from `SecureKeysStep`.
- [ ] On iOS, use a bounded retry with visible state; after timeout show Retry, Enter Recovery Phrase, and Start Fresh.
- [ ] On Android, expose Enter Recovery Phrase before Drive restore.
- [ ] Never auto-create a Recovery Phrase after a failed/missing sync read when a recovery attempt is in progress.
- [ ] Update settings restore and identity import UI for the new tagged outcomes.
- [ ] Add matching en/zh-Hant catalog entries and pass the catalog test.

### Task 6: Define Root Identity switching semantics

- [ ] Add tests for importing the same phrase, importing a different phrase, stale synced phrase, and backup-key change.
- [ ] A same-phrase import remains idempotent.
- [ ] A different-phrase import must invalidate the previous “iCloud protected” claim and require a verified v2 archive under the new key before success copy claims portability.
- [ ] If removal/update of the old synced phrase fails, surface the conflict; do not silently leave `rootKeySyncChoice = 'icloud'`.
- [ ] Document that old archives require the old Recovery Phrase unless an explicit re-encryption migration is approved.

### Task 7: Preserve the active Signing Identity

- [ ] Add failing tests for a delayed syncable key, an existing legacy non-syncable key, explicit first-time creation, and repeated idempotent recovery.
- [ ] Split “look for an existing Signing Identity” from “the user explicitly authorized creating a new Signing Identity”; a missing lookup never authorizes generation during recovery.
- [ ] Remove delete-before-generate from `generateSyncableP256Key`; a generation attempt must not delete either the syncable or legacy key class.
- [ ] If an existing key appears while provisioning is in flight, reuse it and return its public identity rather than replacing it.
- [ ] Onboarding exposes Retry and explicit Start Fresh when the Signing Identity is absent after the bounded recovery window.
- [ ] Preserve existing legacy Secure Enclave keys without rotation.
- [ ] Run focused spruce-did/signing tests, iOS compile, and two-device iCloud Keychain verification.

### Task 8: Report the honest cloud target

- [ ] Add failing JS/native contract tests for the actual file target (`iCloud`, `local-only`, or `googleDrive`).
- [ ] Return that target from the native writer and drive UI truth from it.
- [ ] Treat `local-only` as a typed non-cloud outcome: retain the protected file, but do not set cloud-success state or show cloud-success copy.
- [ ] Generate native bindings only when the Nitro spec changes; commit generated output with the source spec.
- [ ] Run iOS compile/device checks and Android compile checks for the native slice.

### Task 9: Documentation, review, and final verification

- [ ] Update `docs/ref/04-plan-app.md` and `.superpowers/sdd/progress.md` with the approved architecture, migration limits, and device results.
- [ ] Update misleading comments that claim a v1 write is universally Swift-byte-compatible or that a successful Keychain write proves sync is active.
- [ ] Run code review against this plan and resolve all security/correctness findings.
- [ ] From repo root run `bun run typecheck && bun run lint && bun run test`.
- [ ] Confirm no new secrets, `.env`, state files, or parity-fixture edits are present in the diff.

## 9. Device acceptance matrix

Unit tests cannot prove Keychain replication or ubiquity-container delivery. Completion requires real-device evidence:

### iOS

- Device A: create Root Identity → choose iCloud → create v2 archive → verify archive target is iCloud and read-back succeeds.
- Device A: record the active Signing DID after provisioning; confirm no generation call occurs on later recovery checks.
- Device B on the same Apple ID, fresh install: recover the exact same Root DID and Signing DID before any fresh creation; restore cards/contacts/credentials with a different Device Storage Key.
- Repeat with iCloud Keychain initially delayed/off: no silent identity creation; Retry and Recovery Phrase paths work.
- Existing-device v1 restore remains usable when the old Device Storage Key exists.
- A v1 archive on Device B fails with the explicit legacy limitation, not a generic iCloud error.
- Switching Recovery Phrase forces a new verified v2 archive and clears stale “protected” state.

### Android

- Device A: choose Recovery Phrase path → Drive v2 backup.
- Device B: connect the same Drive account → enter the Recovery Phrase before restore → recover identical Root DID and data.
- Without the phrase, the app fails honestly and never claims Drive alone can recover the archive.

## 10. Security invariants

- The Device Storage Key remains device-local and unchanged.
- The Portable Backup Key is used only for Backup Archives.
- Recovery Phrase and derived keys are zero-log data.
- Root recovery never overwrites a valid local Root Identity.
- Missing/delayed sync never authorizes implicit identity rotation.
- New portable writes never fall back to a device-only key.
- Archive version selects exactly one key scheme.
- AES-GCM nonce generation remains random per seal.
- Restored plaintext is re-encrypted under Device B's Device Storage Key when persisted locally.
- No raw error from native security paths escapes to logs with PII.

## 11. Grill decision ledger

Only one decision is asked at a time; each answer is written back here before the next question.

| ID | Blocking decision | Recommendation | Status |
|---|---|---|---|
| **G1** | Does this plan also fix the delayed-sync race for the currently active Signing Identity? | **Include it.** Otherwise “same identity after restore” is true only for the additive Root Identity, while credentials/presentations may still use a newly-minted Signing Identity. | **Accepted — 2026-07-16** |
| **G2** | Does cross-device completion require the native writer to prove it used iCloud rather than local fallback? | **Yes.** A portable key is insufficient if the archive never leaves Device A, and current UI cannot tell. | **Accepted — 2026-07-16** |
| **G3** | Portable Backup Key: derive from Recovery Phrase or sync a random AES key? | **Derive from Recovery Phrase.** It works for iCloud and manual Android recovery, keeps the Device Storage Key local, and avoids another sync race. | **Accepted — 2026-07-16** |
| **G4** | When iCloud Keychain returns empty on a fresh device, may onboarding create a new identity automatically after a timeout? | **No.** Show Retry / Recovery Phrase / explicit Start Fresh; absence is ambiguous. | Pending |
| **G5** | What happens to old v2 archives after intentional Recovery Phrase switching? | **Require a new verified archive; keep old archives readable only with the old phrase.** Do not retain multiple plaintext phrases locally. | Pending |
| **G6** | If the newest archive is unreadable, should restore auto-fallback to an older one? | **No automatic rollback.** Offer dated older backups only after explicit confirmation. | Pending |

## 12. Current workspace state

The source Claude session left these untracked files; they are evidence, not implementation:

- `__tests__/unit/rootKeyCrossDeviceRestore.test.ts`
- `__tests__/unit/backupMasterKeyPortability.test.ts`

They currently pass by asserting the broken behavior. Task 2 and Task 4 must first turn them into failing desired-behavior tests, then make them green. Do not delete or commit them as “fixed” while they still characterize the gap.
