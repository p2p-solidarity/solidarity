# iCloud complete data sync — proposed plan

Status: draft; identity/enrollment semantics await user confirmation. This is a scoped proposal for the reported sync issue, not a replacement for the 2.0.0 north star.

## Confirmed causes

- `backupManager.ts` exports cards, contacts, identity cards, claims and credentials, but omits `profile/store.ts`, `page/pageDesignStore.ts`, local avatar bytes and relevant account preferences.
- Restore calls save/upsert for each record. It neither propagates deletions nor uploads a reconciled result for the other device.
- `cloudProvider.ts` provides dated encrypted archives with global five-file retention, not a sync protocol. Treating the newest archive as authoritative would lose concurrent/offline changes.

## Proposed behavior

Two devices using the same recovered app identity converge after both can access iCloud and complete synchronization. Sharing an Apple account alone does not authorize mixing different app identities. A device with another identity must explicitly enter the existing recovery flow before joining.

- Include profile fields, link privacy, Page drafts/blocks/order/visibility/appearance, avatar assets, contacts/cards, portable credentials/claims, and an explicit allowlist of account/share preferences.
- Inventory every persisted production data store before implementation and record inclusion/exclusion. Device security policy, authentication sessions, biometric configuration, and device-bound keys remain device-owned. Verify remote username/publication state rather than copying a successful-status flag.
- Synchronize changes in both directions on foreground, explicit refresh and debounced local changes while enabled. Report pending/error state honestly; cloud write success is not proof that the other device has received data.
- Distinct record edits combine; concurrent edits of the same logical record have a deterministic winner and retain a recoverable conflicting version. Keep profile signature, privacy metadata and signed projections coherent. Do not merge signed fields into an invalid signature or automatically publish private data.
- Persist deletion markers so deleted records do not return from an offline device. Missing fields in legacy archives mean unavailable, never a deletion.
- Keep dated restore explicit and separate from ongoing synchronization. Import old archives compatibly; do not claim old archives contain omitted profile/avatar data. Define old snapshot rollback as new sync changes, only after an explicit user choice.

## Implementation sequence

1. Confirm same-identity enrollment and initial reconciliation. Map remaining storage, restore callers, wipe barriers, credential portability and native file capabilities; read security review ledger before security changes.
2. Extend versioned backup payload with validated portable data and embedded/bounded local assets. Restore through feature APIs and refresh in-memory stores. Surface partial failure; never report a complete sync after skipping records.
3. Add a pure reconciliation model with identity namespace, stable record IDs, persisted revision metadata, deletion markers and conflict recovery. Use logical revisions and deterministic tie-breaking instead of relying solely on device wall clocks.
4. Use encrypted, unique per-device revisions through existing cloud file infrastructure. Keep sync data separate from archive rotation. Preserve unacknowledged/offline revisions; validate native listing, file coordination and conflict behavior before finalizing retention. Serialize local sync and protect writes against wipe/identity changes. Stage validated changes with recoverable commit handling.
5. Wire foreground/change/manual triggers and localized status into settings. Preserve existing opt-in; joining a different identity is explicit recovery, not background key replacement.
6. Review the diff against this scope and repository standards before claiming completion.

## Acceptance and adversarial checks

- A's name, links, avatar, section order/visibility and privacy appear correctly on B after joining; B's subsequent edits reach A.
- A/B add different contacts offline: both survive after reconnecting; deletion survives an old device rejoining.
- Concurrent edits, equal wall-clock times, retries, interrupted upload, delayed iCloud visibility, disk errors and app restart do not silently discard changes.
- Wrong identity, malformed payload, unsupported schema, missing assets and partial store failure fail honestly without overwriting healthy state.
- Restore an old cards/contacts-only archive without erasing a newer profile. Local wipe during synchronization cannot resurrect data.
- TDD for reconciliation/schema/identity binding and recovery seams. Run root `bun run typecheck && bun run lint && bun run test`; two-device iCloud validation is separately required for delivery behavior that mocks cannot prove.

## Pending decision

Recommended: synchronization requires the same app identity (same recovery phrase); first joining preserves distinct contacts on both devices and reconciles them, with profile conflicts handled explicitly. It must not silently replace B's identity just because A's archive is visible in iCloud.

## Recorded data inventory (2026-09-08)

The plan requires every persisted production store to be consciously included or excluded. Verified against `apps/expo/src` MMKV key constants.

**Portable (reaches the other device).** `cards:*`, `contacts:*`, `vc:*`, `idcard:*`, `provable:*` as encrypted rows; `profile` (`profile:v1`); `page` (`page:design:v1`, minus this device's lapsed-alert state); `avatar` (`profile:local-avatar:v1` plus the file bytes); `snapshot:*` (`profileSnapshots:v1`); and `preference:*` for exactly ten allowlisted account/share settings (`publicPageUsername` and the nine `share*` toggles). A preference equal to its app default is represented by absence.

**Device-owned — deliberately never synced.** Biometric policy and `sensitiveActionPolicy`; atproto/OAuth sessions (Secure Store, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`); keychain and Secure Enclave keys; passport show-witnesses (a synced passport claim is portable evidence, but `isPresentableOnDevice` is re-derived locally); `backupEnabled`/`backupProvider`; `hasCompletedOnboarding`; `developerMode`; `simulateNfc`; `language`; `notifications*`; `rootKeySyncChoice`; and the publish-state mirrors `publicPageRegisteredUsername`/`publicPageBindingReady`/`publicPagePublishError`/`publicPageRetryAt`, which each device re-verifies against the remote rather than copying a success flag. Rebuildable device-local caches (`contacts:auto-refresh:last-sweep:v1`, `contacts:leave-cards:v1`, `contacts:recent-updates:v1`, `manifest:*`) are excluded for the same reason.

**Recorded gaps — not portable in this iteration.** `gg.solidarity.sharing.v1` (per-card/per-group redaction overrides): the store has no UI and no live consumer today, so nothing can be silently widened on the second device — but it MUST join the portable set at the same time it is wired into the share path, or a tightened override will fail to travel with the card it protects. Also outside this iteration: issuer trust anchors (`trust-anchor:`), groups, shoutouts, credential issuer metadata, passport anchors, DAG state, and the encrypted vault (`vault*`, correctly device-keychain-bound; users will still expect it, so it needs its own decision).

## Forward compatibility (2026-09-08)

The portable set is meant to grow (see the recorded gaps above), so a staged rollout will routinely have one device publishing a record type the other has never heard of. That is handled explicitly rather than left to chance:

- An unrecognised record key is **opaque, not invalid**. It is carried in the sync document and republished, so the devices that do understand it keep converging, but it is never validated against a schema this build lacks and never written to local storage.
- It is also carried into the local snapshot before observation. Without that, the older build would publish only what it understands, the unknown record would read as "deleted on this device", and the older build would tombstone the newer device's data — the failure mode this exists to prevent.
- It is excluded from the conflict surface: a build that cannot summarise a record cannot ask the user to choose between two versions of it, and resolving would republish a decision it is not equipped to make.

## Decision — verified-page freshness travels (2026-09-08)

`verifiedAt` on a verified-page snapshot means "when a device last re-checked this page". It lives inside the portable, synced record, and **it stays there**: a device that receives a page by sync or by restore shows the checking device's time rather than "never verified", and does not re-check on arrival. The caption is passive ("3d ago" under *Verified Pages*), so it never claims THIS device did the checking — carrying another device's time is honest with the existing copy.

That leaves one problem to solve rather than two. The auto-refresh sweep rewrites `verifiedAt` on a schedule even when the signed bytes come back byte-identical. Publishing that as an edit would mint a sync version every sweep and, with two devices sweeping independently, retain a conflict for every verified contact — plus churn the auto-backup content digest so archives rotate on time instead of on real edits. So re-observation is excluded from **change detection** (`isObservationOnlyChange`, `cloudSync.currentSnapshot`) and from the backup digest, while the timestamp itself is still persisted, still published, and still drives the caption.

Rejected: freezing the timestamp when content is unchanged. It drives a user-visible freshness signal, so that would report a stale check — a feature loss dressed up as de-duplication. Also rejected: moving the field to a device-local sidecar, which the travelling-freshness decision makes unnecessary.

Consequence, accepted: during total quiescence the value another device sees can lag that device's own latest check, because only a real content change republishes the record. Each device's own sweep keeps its own view fresh, so this is visible only on a device that has never swept the page itself.

## Accepted limitations (reviewed 2026-09-08, not defects)

- **Conflict retention lasts until the record is next edited.** Concurrent versions are kept and offered for explicit choice, but an ordinary local edit to that record supersedes both and the losing version is gone. This is multi-value-register semantics; a durable conflict archive would be a separate design.
- **Each revision is a full snapshot, not a delta**, and includes the avatar. One revision file per device bounds the cloud footprint, but a push still uploads the whole document.
- **Restore is authoritative, by decision (2026-09-08).** Restoring a dated archive is an explicit choice of content: the restored records are authored ON TOP of the next merge (`adopt` in the sync state → `adoptRecords`), so they supersede whatever the other device holds for those records and both devices converge on the restored version. Two consequences are deliberate: a record the archive predates is NOT adopted and keeps reconciling normally, so a restore never deletes what it never knew about; and a contact the other device deleted DOES come back, because the archive is the version the user chose. The confirm copy states both. Before this, the outcome was a coin flip decided by two random install uuids on a device with no prior sync state.
- **An empty snapshot never writes an archive.** A wiped or not-yet-restored device gathers no records; with a small retention window, uploading that would rotate away the archives that still hold the user's data. `requestBackup` skips with `empty` instead.
- **A local wipe does not delete cloud revisions.** Re-enabling backup on a wiped device re-adopts whatever is still in iCloud. Which of "recovery" or "the erase should propagate" is correct is a product decision this plan does not settle.
- **Local sync state that fails to parse stops sync** rather than silently re-enrolling: re-enrolment makes the device's own data concurrent with its history, which can let a stale value win. Clock counters are now capped so a device can never overflow its own state into that condition.
- **Two different app identities under one Apple account still share the five-file archive rotation** (sync revisions are namespaced per identity and do not mix).
