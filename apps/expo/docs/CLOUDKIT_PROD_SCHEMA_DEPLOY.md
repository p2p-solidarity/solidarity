# CloudKit Production Schema Deploy — Groups & Vault (P2 / A2.1)

**Why:** Groups (`src/groups/cloudSync.ts`) and Vault (`src/vault/cloudSync.ts`) still
write **custom CloudKit record types** via `ck.saveRecord`. Production CloudKit
refuses to auto-create record types/fields/indexes (only the **Development**
environment does), so the first prod sync fails with
`CKError "Cannot create new type … in production schema"` — the same error class the
device-backup path was rewritten (to files) to escape. The chosen fix (you have
Dashboard access) is to **deploy the schema to Production**, keeping the code + CKShare
semantics unchanged.

**Container:** `iCloud.kidneyweakx.airmeishi` → **Private Database** → custom zone
**`AirMeishiGroups`** (auto-created at init). Records are JSON-expanded into individual
CKRecord fields by the native `populate()` (`nitro-modules/cloudkit/ios/HybridCloudKit+Mapping.swift:73`),
so each JSON key below is a real CKRecord field.

> CloudKit has no Bool — Swift maps `bool → NSNumber`, stored as **Int(64)** (1/0).
> String arrays map to a **List (String)**. Optional fields are just nullable.

---

## Record type 1 — `AirmeishiGroup`

Saved by `groupToRecord` (`src/groups/cloudSync.ts:127`). Queried by
`fetchAllGroups()` with a **TRUEPREDICATE** (`'{}'`) → the record type must be
**queryable**.

| Field | CloudKit type | Notes |
|---|---|---|
| `id` | String | also the recordName |
| `name` | String | |
| `description` | String | |
| `ownerRecordID` | String | |
| `merkleRoot` | String | optional |
| `merkleTreeDepth` | Int(64) | |
| `memberCount` | Int(64) | |
| `isPrivate` | Int(64) | bool → 1/0 |
| `credentialIssuers` | List (String) | string array |

**Indexes:** `recordName` → **QUERYABLE** (required so the TRUEPREDICATE
`queryRecords` can run; CloudKit will NOT add this automatically).

## Record type 2 — `AirmeishiGroupMember`

Saved by `memberToRecord` (`src/groups/cloudSync.ts:147`). Queried by
`fetchMembers()` with predicate **`groupID = <id>`** → `groupID` must be queryable.

| Field | CloudKit type | Notes |
|---|---|---|
| `id` | String | also the recordName |
| `groupID` | String | **QUERYABLE index required** |
| `userRecordID` | String | |
| `role` | String | `owner` \| `member` |
| `status` | String | `active`/`pending`/`left`/`kicked` |
| `merkleIndex` | Int(64) | |
| `joinedAtMs` | Int(64) | epoch ms |
| `sealedRoute` | String | optional |
| `pubKey` | String | optional |
| `signPubKey` | String | optional |
| `commitment` | String | optional |

**Indexes:** `groupID` → **QUERYABLE**; `recordName` → **QUERYABLE**.

## Record type 3 — `AirmeishiVaultManifest`

Single record id `solidarity.vault.manifest.v1`. Fetched by **recordName only**
(`fetchRecord`), never `CKQuery` → **no custom queryable index needed.**

| Field | CloudKit type | Notes |
|---|---|---|
| `ciphertextB64` | String | AES-GCM sealed manifest (cloud never sees plaintext) |

## Record type 4 — `AirmeishiVaultCipher`

One record per item, id `solidarity.vault.cipher.<itemId>`. Fetched/deleted by
**recordName only** → **no custom queryable index needed.**

| Field | CloudKit type | Notes |
|---|---|---|
| `cipherB64` | String | sealed blob bytes (base64) |
| `sha256` | String | integrity hash |
| `uploadedAt` | Int(64) | epoch ms |

---

## Deploy steps (CloudKit Dashboard)

1. Open **CloudKit Console** → container **`iCloud.kidneyweakx.airmeishi`** →
   **Development** environment → **Schema → Record Types**.
2. Confirm all four record types above exist with the listed fields (they're
   auto-created in Development the first time each `saveRecord` ran). Add any
   missing field with the exact name + type above.
3. **Schema → Indexes** — add the queryable indexes that are NOT auto-created:
   - `AirmeishiGroup`: `recordName` = **Queryable**
   - `AirmeishiGroupMember`: `groupID` = **Queryable**, `recordName` = **Queryable**
   (Vault types need none.)
4. **Deploy Schema Changes to Production** (top-right). Review the diff — it should
   add the 4 record types + the indexes above to Production. Confirm.
5. Verify in **Production**: the record types + indexes are present.

## Post-deploy verification (in the app)

- iOS device signed into iCloud, **release/TestFlight** build (Production CloudKit):
  create a group → it should sync (no `CKError`), appear via `fetchAllGroups()` on a
  second device; vault sync round-trips.
- If still failing, capture the exact `CKError` (`showError` mails the trace to
  `err@solidarity.gg`) — a `partialFailure`/`invalidArguments` naming a field/index
  pinpoints a schema mismatch.

## Known caveats (flag for follow-up, not part of the deploy)

- **Shared-DB join mismatch:** `fetchSharedRecords` (`HybridCloudKit.swift:313`) queries
  record type **`CD_AirmeishiGroupRecord`** (an `NSPersistentCloudKitContainer`-style
  name) which the write path never creates. The CKShare *join* flow likely can't read
  members until this is reconciled (write `AirmeishiGroup`/`AirmeishiGroupMember` ↔ read
  `CD_…`). Track separately from the prod-schema deploy.
- **Code-side hardening (A2, separate commits):** add a typed `CKError` surface so a
  schema/permission failure shows a clear message; the native legacy-Keychain read for
  SwiftUI→Expo upgraders; and a real iOS ubiquity-vs-local backup-target signal. See
  `docs/superpowers/specs/2026-06-02-figma-parity-and-icloud-stability-design.md` §A2.
