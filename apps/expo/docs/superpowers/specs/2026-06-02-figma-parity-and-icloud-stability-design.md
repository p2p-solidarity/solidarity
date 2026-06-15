# Figma 1:1 Parity + iCloud Stability — Design Spec

**Date:** 2026-06-02
**Branch:** `1.3.1`
**Author:** brainstorming session (Claude)
**Status:** Draft — awaiting user review

## Goal

Two concurrent tracks, both requested by the user:

- **Track A — iCloud stability.** The backup/iCloud layer has been "very unstable
  recently." Root-cause and fix it. The user confirmed **all four** symptom classes
  are happening: groups/vault won't sync, backups fire/err constantly, restore
  fails/loses data, and the provider toggle does nothing / wrong target.
- **Track B — UI 1:1 with Figma.** Bring People / Share / Me / Settings to pixel
  parity with 4 Figma frames, porting the canonical design from the SwiftUI app
  (`solidarity/`). The app is already "very close" — this is a **detail** pass.

### Decisions locked in brainstorming

| Decision | Choice |
|---|---|
| Focus | **Both tracks at once** |
| Figma language | **Proper i18n (en + zh-Hant)** — use Figma's wording as the zh-Hant value; natural English for the other locale |
| Parity depth | **High + medium deltas** (skip sub-pixel padding nits) |
| iCloud symptoms | **All four** — comprehensive overhaul |
| Groups/Vault fix | **Predeploy CloudKit schema to Production** (Dashboard) — keep code + CKShare semantics |
| "Work" button | **Build a real "work" presentation context** end-to-end — in scope |
| A2 environment | User can do **on-device testing + CloudKit Dashboard + Apple provisioning** |

### Already verified (no work needed)

- **Design tokens map 100% to Figma.** `Colors.ts` / `tailwind.config.js` /
  `global.css` already mirror the 8 Figma tokens (`text1 #2f2f30`, `text2 #5f5e67`,
  `text3 #9c9aa6`, `divider #d1d1d1`, inset `#eeeeee`, rose `#cd556a`,
  green `#4caf51`, purple→`primaryMauve #83537d`). No token rework.
- Themed primitives (`ThemedText` / `ThemedSurface` / `ThemedButton`) cover all
  needed variants. Reuse them; do not roll new primitives.

## Non-goals / explicitly out of scope

- **`app/share/qr.tsx` full-page QR redesign** — expo-only extra, not in Figma/Swift.
  Left as-is.
- **Settings trailing badges** (`Commitment active`, `0 groups`) — hidden placeholder
  layers in Figma, shown by neither real app. Not added (fake data).
- **Low-severity pixel nits** (sub-2pt padding/radius) — per "high + medium" choice.

> The **"Work" button is now in scope** (real "work" presentation context — see B3).
> The **A2 native iCloud fixes are unblocked**: the user can run on-device tests, deploy
> the CloudKit schema to Production, and confirm provisioning, so those fixes are
> implemented and *verified*, not added blind.

---

## Track A — iCloud stability

Architecture recap: backup is a thin JS facade (`src/backup/*`) over the
`@solidarity/nitro-cloudkit` HybridObject. iOS writes encrypted SOLB-framed
`backup_<ts>.solbk` files into the iCloud Drive ubiquity container (local Documents
fallback); Android writes to a Drive folder via OkHttp. The **file-based backup path
itself is correct** (commit `7cddf27`). The instability is *around* it.

### A1 — Pure-JS fixes (low risk, do first)

**A1.1 — Stop the unconditional backup on every People refresh.**
`usePeopleScreen.refresh()` calls `performBackupNow()` with no guard — ignoring
`backupEnabled` *and* `autoBackupOnPull`, racing the 5-file rotation, and surfacing
errors at random.
- Route **every** trigger (settings button, pull-to-refresh, pan gesture, onboarding
  restore) through **one coordinated entrypoint** that: reads prefs, applies a single
  cooldown, selects the provider once.
- Gate pull-to-refresh behind `backupEnabled && autoBackupOnPull`.
- Files: `src/people/usePeopleScreen.ts`, `app/(tabs)/people/index.tsx`,
  `src/backup/backupManager.ts` (new `requestBackup()` coordinator or extend existing).
- Risk: **low** (strictly more conservative). Keep backup off the first-paint path.

**A1.2 — Make the provider preference actually work.**
`setProvider()` is exported but never called; `uploadBackup/downloadBackup/backupMtime`
read a stale module-level `activeProvider`. Android's refresh path hard-codes
`DEFAULT_PROVIDER`, so picking iCloud↔Drive does nothing / wrong target.
- Call `setProvider(pref)` on app start and on pref change; resolve provider from the
  pref inside the facade. Remove or document the misleading metadata-only `provider`
  arg in `backupManager`.
- Files: `src/backup/cloudProvider.ts`, `app/settings/backup.tsx`,
  `src/backup/backupManager.ts`, `src/settings/preferences.ts`.
- Risk: **low** (re-init already handled by `setProvider`).

**A1.3 — Chronological "newest backup" selection.**
`cloudProvider.ts` picks newest via lexicographic `.sort()` of filenames; breaks across
digit-count boundaries and when Swift decimal `.solbk` timestamps coexist with expo
integer ones → restore can pick a **stale** backup.
- Parse the numeric timestamp (handle integer + Swift decimal forms) and pick max, or
  sort by `getFileBackupMtime`. Switch new filenames to fixed-width ms to avoid
  same-second collisions. Fix the false comment.
- Add a unit test alongside `icloudBackupRoundtrip` with mixed int/decimal/short names.
- Files: `src/backup/cloudProvider.ts`, `__tests__/`.
- Risk: **low** (keep reading old filenames; only selection/new-name change).

**A1.4 — Restore key-mismatch → clear message (JS half of A2.2).**
In-place SwiftUI→Expo upgraders mint a fresh master key, so restore downloads a real
file but AES-GCM open fails → generic "restore failed."
- On restore, catch the AES-GCM auth-tag failure specifically and present
  "this backup was made with a different key / older app version" — not flaky-iCloud.
- Files: `src/backup/backupManager.ts`, `src/storage/encryptionManager.ts`.
- Risk: **low**.

**A1.5 — Android Drive auth: typed "needs connection" state.**
`ensureDriveAuth` swallows all failures; a missing token then throws a downstream 401
surfaced as an opaque error.
- Distinguish no-token/declined from transient errors; propagate a typed
  "needs Google connection" state so the UI prompts instead of erroring.
- Files: `src/backup/cloudProvider.ts`, `src/backup/googleAuth.ts`, `app/settings/backup.tsx`.
- Risk: **low** (degrade gracefully; never block first paint).

### A2 — Native / CloudKit fixes (higher risk; need user environment)

**A2.1 — Groups & Vault still on the broken custom-CKRecord path. ⚠ highest-impact.**
`src/groups/cloudSync.ts` + `src/vault/cloudSync.ts` still `ck.saveRecord` with custom
record types (`AirmeishiGroup`, `AirmeishiGroupMember`, `AirmeishiVaultManifest`,
`AirmeishiVaultCipher`) → the **exact prod-schema `CKError`** the backup path was
rewritten to escape. This is the most likely cause of "groups/vault won't sync."

**Chosen approach: predeploy the schema to Production** (user has Dashboard access).
Keeps the code + CKShare cross-device semantics; the fix is a Dashboard action plus a
code audit to guarantee the records the code writes exactly match the deployed schema.
- **Deliverable for the user:** an exact record-type → field-name → field-type list,
  extracted from `groups/cloudSync.ts` + `vault/cloudSync.ts` (record types
  `AirmeishiGroup`, `AirmeishiGroupMember`, `AirmeishiVaultManifest`,
  `AirmeishiVaultCipher`), plus any required query indexes (CloudKit needs explicit
  queryable/sortable indexes — a common second cause of CKError). User clicks "Deploy
  Schema Changes to Production."
- **Code work:** audit that field names/types written by the code match; add a typed
  CKError surface so a schema/permission error becomes a clear message, not silent
  failure; verify Development-vs-Production container targeting.
- Files: `src/groups/cloudSync.ts`, `src/vault/cloudSync.ts`,
  `nitro-modules/cloudkit/ios/HybridCloudKit.swift`.
- Risk: **low code**; the Dashboard deploy is reversible-ish but getting field/index
  defs wrong re-breaks sync — hence the exact deliverable list + a post-deploy round-trip test.

**A2.2 — Native raw-Keychain legacy read (upgraders).**
The documented legacy recovery is a near-certain miss (raw AES bytes unreadable via
SecureStore string API). Implement `readLegacyGenericPassword(service, account) -> Data`
in the secrets-vault Nitro module; call it from `getMasterKey` before minting a fresh
key. Until then, A1.4 at least makes the failure legible.
- Files: `src/storage/secureMasterKey.ts`, secrets-vault Nitro (Swift), `SecureKeysStep.tsx`.
- Risk: **medium** — security-critical key path; must be **device-verified** (per
  CLAUDE.md, not added blind), no PII logs, return `Result`.

**A2.3 — Surface real iOS backup target (ubiquity vs local).**
`resolvedBackupDir` silently falls back to local Documents when the ubiquity container
is nil (entitlement not provisioned, or iCloud signed out), while the UI still says
"connected" → cross-device "my backup didn't show up."
- `writeFileBackup` returns/emits which target it used; drive `settings/backup.tsx`
  status from that + `CKAccountStatus`, not merely from `backupMtime()` succeeding.
- Verify the `ubiquity-container-identifiers` entitlement (added `7cddf27`) is actually
  granted in the **release provisioning profile** (Apple portal — yours to confirm).
- Files: `nitro-modules/cloudkit/ios/HybridCloudKit+FileBackup.swift`, `app.json`,
  `app/settings/backup.tsx`.
- Risk: **low-medium** code; provisioning is an Apple-portal action.

> **Guardrail (CLAUDE.md):** any `: ArrayBuffer` param read inside a Nitro
> `Promise.async` is the non-owning-buffer SIGTRAP footgun. The backup path uses
> `String`, so it's clean — but A2.1/A2.2 native edits must copy any ArrayBuffer to an
> owning `Data` *before* `Promise.async`.

---

## Track B — UI 1:1 parity

Cross-cutting: **all hardcoded user-facing strings route through i18next** with `en` +
`zh-Hant` entries. Where Figma left chrome in English, supply a natural zh-Hant
translation (proper-i18n choice). Never add strings/values that don't come from a real
source (no-fake-data rule).

### B1 — People (`723-2191`)
Closest surface; almost entirely i18n + chip details.

| Sev | Item | Location | Fix |
|---|---|---|---|
| high | Hardcoded `Search` placeholder | `PeopleSearchField.tsx` | `t()` → zh `搜索` |
| high | Empty-state copy hardcoded | `app/(tabs)/people/index.tsx` | `t()` → `你的聯絡人通訊錄是空的` / `匯入手機通訊錄` / `手動新增` |
| med | Ephemeral label `sakura` hardcoded | `PersonDetailEphemeralSection.tsx` | `t()` → zh `一期一會` (en: "Sakura"/TBD-natural) |
| med | `see more N messages` hardcoded | same | `t(..., { count })` |
| med | Note / Add text / Delete / Edit / Done hardcoded | `PersonDetailMoreSheet.tsx` | `t()` each |
| med | Context tags English vs Figma zh chips | `TrustGraphContactRow.tsx` | localize source→chip (`#手機通訊錄`, `在 DID Workshop 認識的`) |
| med | Tag chip bg uses `searchBg` | `TrustGraphContactRow.tsx` | use chip surface token to match Figma |

### B2 — Share (`726-22959`)

| Sev | Item | Location | Fix |
|---|---|---|---|
| high | Peers don't orbit the radar | `RadarMatching.tsx`, `app/(tabs)/share/index.tsx` | add `peers` prop; render ≤8 avatars at `angle=2π/n·i−π/2`, `r=size·0.35`; status ring colors (port Swift `RadarMatchingView`) |
| med | `QrShareCard` footer layout vs Figma `726:23611` | `QrShareCard.tsx` | verify avatar+name+real-human badge+field pills row; QR; Show/Hide full-width + share icon (50×46) |
| med | Share Settings legend placement / QR-preview card styling | `app/settings/share-settings.tsx` | align legend + QR card border/bg to Figma |
| med | Incoming-invitation ring color fixed purple | `IncomingInvitationPopup.tsx` | status-based ring color |
| (i18n) | Scan nav `Close` hardcoded | `app/scan/index.tsx` | `t()` |

### B3 — Me (`724-22725`)

| Sev | Item | Location | Fix |
|---|---|---|---|
| high | Credential disclosures use checkboxes | `app/credentials/[id].tsx` (`ClaimRow`) | replace with on/off toggle switches per Figma |
| high | "Show" + **"Work"** dual buttons | `DisclosureRowView.tsx` + model + proof | **build real "work" context** — see B3.1 |
| med | Passport "Selective Disclosures" checklist not rendered | `app/passport/index.tsx`, `PassportSteps.tsx` | render real `DEFAULT_DISCLOSURE_POLICY` checklist w/ green checks |
| med | Credential claim status badges | `app/credentials/[id].tsx` | add "Verified by passport"/"Self-attested" **only if** the VC carries it (real) |
| med | Group cards "12 Share Inst" suffix | `YourGroupsSection.tsx` | show **only if** a real share-count exists in `GroupModel`; else omit (no fake) |
| med | Issue-Group-VC recipients toggle styling | `GroupVCIssuanceSections.tsx` | match Figma toggle/spacing |

#### B3.1 — "Work" presentation context (new feature)

Figma shows `Show` + `Work` on disclosure rows. Neither app implements it, so it must be
built as a real feature, not a stub. Swift's `BusinessCard.groupContext:
GroupCredentialContext?` is the lead — the intended meaning is **present this disclosure
using a "work" business-card context** rather than the default personal card.

Scope (to be pinned in the implementation plan after a short model investigation):
1. **Model** — a presentation-context selector on the card/claim (reuse Swift's
   `groupContext` concept; add the expo-side field if absent). No fabricated data — if a
   user has no work card, the "Work" button is hidden, not a no-op.
2. **Proof payload** — include the selected context so the verifier/QR reflects which
   card was presented.
3. **QR / presentation** — generate the presentation for the chosen context.
4. **UI** — extend `DisclosureRowView` to render `Show` + `Work` (right-aligned group,
   matching Figma styling), wired to the two contexts; `Work` shown only when a real work
   context exists.

This is the one part of Track B that is a feature, not a visual tweak — planned and
tested as such, kept in parity with the Swift model.

### B4 — Settings (`763-4840`)

| Sev | Item | Location | Fix |
|---|---|---|---|
| high | Missing scan icon top-right in header | `app/settings/index.tsx`, `SettingsBlocks.tsx` | add trailing scan icon **iff** Swift `SettingsView` has it; route to `/scan` (verify intent) |
| med | Replay Onboarding accent styling | `app/settings/index.tsx` | rose/purple icon+text **iff** Figma render + Swift confirm it |
| — | Trailing `Commitment active` / `0 groups` | — | **do not add** (hidden placeholder = fake) |
| — | Version | already real runtime value | no change |

---

## Execution strategy

"Both at once" + ultracode → run as **parallel workflows**, each phase reviewed before
the next:

1. **iCloud-A1 workflow** (pure-JS coordinator + provider wiring + sort fix + restore
   message + Android auth) with unit tests — lands independently, low risk.
2. **UI-parity workflow** — one implementer per surface (People/Share/Me/Settings) in
   parallel, each given its delta table + the per-screen Figma `get_design_context`,
   plus a shared i18n-keys sub-task. Worktree isolation if they touch shared files.
3. **iCloud-A2** — staged after A1 and after the user resolves the groups/vault
   approach + provides CloudKit Dashboard / device access. Native edits are
   device-verified, not blind.

Each workflow's output is verified: `bun run typecheck` (0 errors), `bun test`,
`bun run lint`, and a visual diff of the touched screens against Figma.

## Testing & verification

- New unit test: mixed-format backup filename selection (A1.3).
- Round-trip: provider switch actually changes target (A1.2).
- Regression: People refresh no longer backs up when disabled (A1.1).
- Typecheck / test / lint green before each track is declared done.
- Visual: screenshot each touched screen, compare to its Figma frame.
- A2 native: on-device verification (the iCloud/Keychain paths cannot be validated in
  the simulator alone).

## Open decisions — RESOLVED (2026-06-02)

1. **Groups/Vault approach (A2.1):** ✅ Predeploy CloudKit schema to Production (user has
   Dashboard access). Keep code + CKShare.
2. **"Work" button:** ✅ Build a real "work" presentation context end-to-end (B3.1).
3. **A2 environment:** ✅ User can do on-device testing, CloudKit Dashboard deploy, and
   Apple-portal provisioning — A2 fixes are verified, not blind.

### Remaining to pin during planning
- Exact "work context" data model (short investigation: Swift `GroupCredentialContext`
  ↔ expo card/claim model).
- Exact CloudKit record-type/field/index list to hand the user for the prod deploy.
