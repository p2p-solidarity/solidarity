/**
 * Profile store — local source of truth for the user's signed Profile
 * Record (01-spec §3), the payload published via QR / URL fragment
 * (`packages/shared`'s `encodeFragment`) once `app/me/edit.tsx` saves it
 * (1.3.3 Task A2.2).
 *
 * Persisted at MMKV key `profile:v1` as `{ record, jws }` — mirrors
 * `settings/preferences.ts`'s DEFAULTS-in-memory + `hydrateX()`-from-MMKV
 * pattern (CLAUDE.md rule 10: no `await` on the render path). The store
 * starts `{ record: null, jws: null, status: 'empty' }` so a screen renders
 * on frame 1 before `hydrateProfile()` (called once from the root layout,
 * after `initMmkv()` resolves — see `app/_layout.tsx`) swaps in the
 * persisted pair synchronously.
 *
 * Append-only semantics (01-spec §3; Pear day-0 constraint 2): `saveProfile`
 * NEVER mutates the currently-stored record in place. Every call builds a
 * BRAND NEW record object — fresh `updatedAt`, the root did resolved fresh
 * via `getRootDid()`, the editable fields (`displayName`/`bio`/`links`) from
 * the caller, narrow explicit overrides (`avatar`/`alsoKnownAs`) where a
 * flow supplies them, and every other field carried forward from the
 * PREVIOUS stored record (or a real `null`/`[]` default on the first save,
 * never a fabricated placeholder) — then validates, signs, and REPLACES the stored
 * `(record, jws)` pair wholesale, both in memory and in MMKV.
 *
 * Validation happens strictly BEFORE signing: `parseProfile` runs on the
 * candidate record and returns `err(...)` on failure before `getRootSigner()`
 * is ever called — an invalid save must never trigger the Face ID prompt.
 * `getRootSigner()`'s returned `Signer` gates every call behind biometrics
 * and THROWS (does not return `Result`) on denial — see `rootKey.ts`'s
 * `@warning` — so the `signCompact` call below is wrapped in try/catch.
 */
import { create } from 'zustand';

// Imported directly from `./rootKey`, NOT the `@/identity` barrel: the
// barrel also re-exports `coordinator.ts` / `dataStore.ts`, which pull in
// `@/keychain/signingKey` (SpruceID Nitro module) and transitively
// `react-native`'s Flow-syntax entry point — unloadable by bun's test
// parser (see `rootKey.ts`'s own module doc for the identical reasoning on
// its lazy `expo-secure-store` import). `getRootDid`/`getRootSigner` are
// plain exports either way; importing them from the leaf module keeps this
// store's test (`__tests__/unit/profileStore.test.ts`) import-safe without
// any `mock.module` on `@/identity`.
import {
  invalidateCachedAtprotoResult,
  invalidateCachedNostrResult,
} from '@/badges/badgeStatusCache';
import { getRootDid, getRootSigner, type RootKeyError } from '@/identity/rootKey';
import { publishProfile, updateKind0AlsoKnownAs, type PublishReport } from '@/nostr/publish';
import { getNostrPubkey, npubEncode } from '@/nostr/userKey';
import { canCommitLocalData, captureLocalDataEpoch } from '@/settings/localDataWipeBarrier';
import { getMmkv } from '@/storage/mmkv';
import {
  PROFILE_VERSION,
  err,
  ok,
  parseProfile,
  signCompact,
  type ProfileLink,
  type ProfileBadge,
  type PublicPageDesign,
  type ProfileRecord,
  type ProfileScope,
  type Result,
  type Signer,
} from '@solidarity/shared';

import {
  buildProjection,
  normalizeLinkVisibility,
  type LinkVisibility,
  type LocalProfile,
} from './projection';

const KEY = 'profile:v1';

// ── Nostr publish seam — own module-level DI (same pattern as `userKey.ts`'s
//    `__setNostrKeyStorageForTesting` / `rootKey.ts`'s
//    `__setRootKeyStorageForTesting`) rather than `mock.module('@/nostr/
//    publish', ...)`: `mock.module` patches the module registry for the
//    whole `bun test` process, which would leak into `nostrPublish.test.ts`
//    (which imports the REAL `publishProfile`/`updateKind0AlsoKnownAs` to
//    test their actual relay-quorum logic) if both files run in the same
//    process — see `rootKey.test.ts`'s isolation note for the identical
//    reasoning. This seam also keeps `publishToNostr`'s tests from ever
//    opening a real WebSocket (CLAUDE.md: "Do NOT hit real relays in
//    tests"). ───────────────────────────────────────────────────────────

type PublishProfileFn = typeof publishProfile;
type UpdateKind0Fn = typeof updateKind0AlsoKnownAs;

let activePublishProfile: PublishProfileFn = publishProfile;
let activeUpdateKind0AlsoKnownAs: UpdateKind0Fn = updateKind0AlsoKnownAs;
let localWipeGeneration = 0;

/**
 * A profile operation is valid only while both its store generation and the
 * process-wide deletion epoch still match. The generation protects direct
 * store resets; the epoch also rejects work that starts while the destructive
 * wipe coordinator is already quiescing the rest of the device.
 */
function canContinueProfileOperation(generation: number, localDataEpoch: number): boolean {
  return generation === localWipeGeneration && canCommitLocalData(localDataEpoch);
}

/** Test-only override. Pass `null` to restore the real relay-backed implementations. */
export function __setNostrPublishForTesting(
  overrides: { readonly publishProfile?: PublishProfileFn; readonly updateKind0AlsoKnownAs?: UpdateKind0Fn } | null
): void {
  activePublishProfile = overrides?.publishProfile ?? publishProfile;
  activeUpdateKind0AlsoKnownAs = overrides?.updateKind0AlsoKnownAs ?? updateKind0AlsoKnownAs;
}

export type ProfileStatus = 'empty' | 'ready';

/** A signed projection of the local profile at one scope (T7). The `record`'s
 *  `scope` matches the projection; `jws` is a compact JWS signed by the root
 *  did:key over exactly that record. */
export interface SignedProjection {
  readonly record: ProfileRecord;
  readonly jws: string;
}

/**
 * The text/link subset supplied on every editor save. Avatar and binding
 * changes use the narrow options below; remaining fields carry forward.
 *
 * `linkVisibility` (T7) is the per-link privacy tier, parallel to `links` by
 * index and LOCAL only — it is stored in this store's MMKV blob, never in the
 * signed wire record. Optional and back-compat: a caller that omits it (or a
 * shorter array than `links`) leaves every unspecified link `'public'`, so
 * every existing `saveProfile` caller keeps its prior all-public behaviour.
 */
export interface ProfileEditableFields {
  readonly displayName: string;
  readonly bio: string;
  readonly links: readonly ProfileLink[];
  readonly linkVisibility?: readonly LinkVisibility[];
}

/** Narrow service-level overrides for signed binding and avatar flows. */
export interface ProfileSaveOptions {
  readonly alsoKnownAs?: readonly string[];
  readonly avatar?: string | null;
  /** Narrow identity-level badge replacement (e.g. public disclosure refs). */
  readonly badges?: readonly ProfileBadge[];
  /** Signed Page layout. Local editor state never enters this value. */
  readonly page?: PublicPageDesign;
  /**
   * The reviewed webSign draft's own stamp (`app/websign/review.tsx`). Adopted
   * only when it still advances the append-only clock past the previous
   * record; otherwise the monotonic default applies. Carrying the draft's
   * stamp keeps the published projection byte-identical to the record the
   * website confirms against.
   */
  readonly updatedAt?: string;
}

/** The exact pair persisted by a successful Face-ID-gated save. */
export interface SavedProfile {
  readonly record: ProfileRecord;
  readonly jws: string;
}

interface PersistedProfile {
  /** The FULL source-of-truth record (all links, `scope` absent = full). */
  readonly record: ProfileRecord;
  readonly jws: string;
  /** Per-link visibility, parallel to `record.links` (T7). */
  readonly linkVisibility: readonly LinkVisibility[];
  /** The pre-signed `shared` projection (public + link-only links) used by the
   *  QR / URL-fragment share path, or null for a pre-T7 blob. */
  readonly shared: SignedProjection | null;
  /** The pre-signed `public` projection (public links only) published to
   *  Nostr, or null for a pre-T7 blob. */
  readonly published: SignedProjection | null;
  /**
   * The exact public-projection JWS for which at least one relay accepted
   * BOTH the profile pointer and the kind-0 reverse binding. A later save
   * clears this marker before any share UI can offer the Nostr short URL.
   */
  readonly nostrPublishedJws: string | null;
}

/** Re-validate one persisted projection (T7) — its `record` must still
 *  `parseProfile` and `jws` be a non-empty string, else drop it to null so the
 *  share/publish path falls back to re-signing rather than trusting a
 *  schema-drifted blob. */
function readProjection(raw: unknown): SignedProjection | null {
  if (raw === null || typeof raw !== 'object') return null;
  const p = raw as { readonly record?: unknown; readonly jws?: unknown };
  if (typeof p.jws !== 'string' || p.jws.length === 0) return null;
  const validated = parseProfile(p.record);
  return validated.ok ? { record: validated.value, jws: p.jws } : null;
}

function readPersisted(): PersistedProfile | null {
  try {
    const raw = getMmkv().getString(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      record?: unknown;
      jws?: unknown;
      linkVisibility?: unknown;
      shared?: unknown;
      published?: unknown;
      nostrPublishedJws?: unknown;
    };
    if (typeof parsed.jws !== 'string' || parsed.jws.length === 0) return null;
    // Re-validate on read, not just on write — a hand-edited or
    // schema-drifted MMKV blob must fail closed to 'empty', never hand a
    // screen a record that only LOOKS like a ProfileRecord.
    const validated = parseProfile(parsed.record);
    if (!validated.ok) return null;
    // Back-compat: a pre-T7 blob carries neither `linkVisibility` (→ every
    // link defaults to 'public') nor the pre-signed projections (→ null; the
    // share/publish paths re-derive + re-sign on demand). A pre-T7 blob has no
    // private links anyway, so a null `shared` safely falls back to the full
    // record without leaking anything.
    const linkVisibility = Array.isArray(parsed.linkVisibility)
      ? normalizeLinkVisibility(
          validated.value.links,
          parsed.linkVisibility.filter((v): v is LinkVisibility => typeof v === 'string')
        )
      : normalizeLinkVisibility(validated.value.links, undefined);
    const published = readProjection(parsed.published);
    return {
      record: validated.value,
      jws: parsed.jws,
      linkVisibility,
      shared: readProjection(parsed.shared),
      published,
      nostrPublishedJws:
        typeof parsed.nostrPublishedJws === 'string' &&
        published?.jws === parsed.nostrPublishedJws
          ? parsed.nostrPublishedJws
          : null,
    };
  } catch {
    return null;
  }
}

type PersistWriteResult = 'ok' | 'cancelledByWipe' | 'storageFailure';

function writePersisted(p: PersistedProfile, localDataEpoch: number): PersistWriteResult {
  if (!canCommitLocalData(localDataEpoch)) return 'cancelledByWipe';
  try {
    getMmkv().set(KEY, JSON.stringify(p));
  } catch {
    // A profile JWS is also the sharing/publication source of truth. Unlike
    // cosmetic preferences, it must not look published for one session and
    // disappear after restart, so callers fail the whole operation.
    return 'storageFailure';
  }
  // A wipe may have begun while the synchronous storage adapter was doing
  // its work. Never repopulate the live store in that case; the wipe owns the
  // durable state and will scrub any write that raced it.
  return canCommitLocalData(localDataEpoch) ? 'ok' : 'cancelledByWipe';
}

/**
 * Build the `scope` projection of a local profile and sign it with the
 * already-resolved root `Signer` (T7). Validates the projected record before
 * signing (same "validate strictly before signing" discipline as
 * `saveProfile`). Reuses the caller's ONE `getRootSigner()` result so signing
 * all three projections stays inside a single biometric grace window — never
 * a prompt per projection. The signer THROWS on biometric denial (see
 * `rootKey.ts`'s `@warning`), so the `signCompact` call is wrapped.
 */
async function signProjection(
  local: LocalProfile,
  scope: ProfileScope,
  signer: Signer
): Promise<Result<SignedProjection, string>> {
  const projected = parseProfile(buildProjection(local, scope));
  if (!projected.ok) return err(projected.error);
  try {
    const jws = await signCompact(projected.value, projected.value.did, signer);
    return ok({ record: projected.value, jws });
  } catch (e) {
    return err(`signing was denied or failed (${e instanceof Error ? e.message : String(e)})`);
  }
}

/** Sign the two SHARE projections (`shared` for QR, `public` for Nostr) of a
 *  local profile with the already-resolved root signer, in that order and one
 *  grace window. Either failure short-circuits (never a half-signed pair). */
async function signShareProjections(
  local: LocalProfile,
  signer: Signer
): Promise<Result<{ readonly shared: SignedProjection; readonly published: SignedProjection }, string>> {
  const sharedResult = await signProjection(local, 'shared', signer);
  if (!sharedResult.ok) return err(sharedResult.error);
  const publishedResult = await signProjection(local, 'public', signer);
  if (!publishedResult.ok) return err(publishedResult.error);
  return ok({ shared: sharedResult.value, published: publishedResult.value });
}

/**
 * Strictly-increasing ISO timestamp. Two `saveProfile` calls landing in the
 * same millisecond (rapid taps, or two `await`s in the same test tick) must
 * still produce an `updatedAt` that actually advances — plain
 * `new Date().toISOString()` would silently produce a tie.
 */
function nextUpdatedAt(previous: string | null): string {
  const nowMs = Date.now();
  if (previous === null) return new Date(nowMs).toISOString();
  const previousMs = Date.parse(previous);
  const nextMs = nowMs > previousMs ? nowMs : previousMs + 1;
  return new Date(nextMs).toISOString();
}

/**
 * A caller-supplied stamp (the webSign draft's) wins only when it is a valid
 * ISO instant that advances past the previous record — the append-only clock
 * never moves backwards or stalls because a website said so.
 */
function adoptUpdatedAt(requested: string | undefined, previous: string | null): string {
  const fallback = nextUpdatedAt(previous);
  if (requested === undefined) return fallback;
  const requestedMs = Date.parse(requested);
  if (Number.isNaN(requestedMs)) return fallback;
  if (previous !== null && requestedMs <= Date.parse(previous)) return fallback;
  return requested;
}

function avatarForSave(
  previous: string | null,
  override: string | null | undefined
): string | null {
  return override === undefined ? previous : override;
}

/** Assemble the FULL candidate record (all links, `scope` absent = full) from
 *  the editable fields, narrow overrides, and the previous record's carried-
 *  forward fields. Pure — validated + signed by the caller. */
function buildCandidateRecord(
  fields: ProfileEditableFields,
  options: ProfileSaveOptions,
  previous: ProfileRecord | null,
  did: string
): Record<string, unknown> {
  const page = options.page ?? previous?.page;
  return {
    v: PROFILE_VERSION,
    did,
    displayName: fields.displayName,
    avatar: avatarForSave(previous?.avatar ?? null, options.avatar),
    bio: fields.bio,
    links: fields.links,
    alsoKnownAs:
      options.alsoKnownAs !== undefined ? [...options.alsoKnownAs] : (previous?.alsoKnownAs ?? []),
    badges: options.badges !== undefined ? [...options.badges] : (previous?.badges ?? []),
    ...(page ? { page } : {}),
    supersededBy: previous?.supersededBy ?? null,
    updatedAt: adoptUpdatedAt(options.updatedAt, previous?.updatedAt ?? null),
  };
}

function rootKeyErrorMessage(prefix: string, e: RootKeyError): string {
  switch (e.kind) {
    case 'notProvisioned':
      return `${prefix}: no root identity is set up on this device yet`;
    case 'biometricDenied':
      return `${prefix}: biometric authentication was denied`;
    case 'invalidMnemonic':
      return `${prefix}: ${e.message}`;
    case 'storageFailed':
      return `${prefix}: ${e.message}`;
  }
}

function confirmedNostrPublishedJws(
  currentMarker: string | null,
  candidateJws: string,
  profileReport: PublishReport,
  kind0Report: PublishReport
): string | null {
  return profileReport.acceptedCount >= 1 && kind0Report.acceptedCount >= 1
    ? candidateJws
    : currentMarker;
}

/** Combined publish outcome — both bindings of task A4.2's bidirectional pair. */
export interface NostrPublishOutcome {
  /** kind-30078 profile pointer (`content` = the profile JWS). */
  readonly profile: PublishReport;
  /** kind-0 metadata event with `did:key` merged into `content.alsoKnownAs`. */
  readonly kind0: PublishReport;
}

interface ProfileState {
  /** The FULL source-of-truth record — every field, ALL links (`scope`
   *  absent = full). This is the user's own view and the Pear/full exchange
   *  card; the QR/Nostr share paths use the projections below instead. */
  readonly record: ProfileRecord | null;
  readonly jws: string | null;
  readonly status: ProfileStatus;
  /** Per-link visibility tiers, parallel to `record.links` (T7 — LOCAL only). */
  readonly linkVisibility: readonly LinkVisibility[];
  /** Pre-signed `shared` projection (public + link-only links) for the QR /
   *  URL-fragment share surface, or null before the first T7-era save. */
  readonly shared: SignedProjection | null;
  /** Pre-signed `public` projection (public links only) published to Nostr,
   *  or null before the first T7-era save. */
  readonly published: SignedProjection | null;
  /**
   * The currently published public-projection JWS, or null when the local
   * profile is newer than every honestly confirmed Nostr copy.
   */
  readonly nostrPublishedJws: string | null;
  /**
   * Validate → (Face-ID) sign → persist, in that order. Returns
   * `err(reason)` without ever touching `getRootSigner()` (so without ever
   * prompting Face ID) when `fields` don't produce a valid `ProfileRecord`.
   * Signs THREE projections (full + shared + public) under one biometric
   * grace window so the QR and Nostr share paths each have a pre-signed,
   * link-filtered record ready without a further prompt.
   */
  readonly saveProfile: (
    fields: ProfileEditableFields,
    options?: ProfileSaveOptions
  ) => Promise<Result<SavedProfile, string>>;
  /** Save only the signed public Page projection while carrying all editable
   * profile fields and their existing privacy tiers forward. */
  readonly savePageDesign: (page: PublicPageDesign) => Promise<Result<SavedProfile, string>>;
  /**
   * Publish the signed profile to Nostr (kind 30078) AND merge the
   * user's did:key into their kind-0 `alsoKnownAs` — the two directions
   * of task A4.2's bidirectional binding (see `nostr/publish.ts`'s
   * module doc). Does NOT auto-run and does NOT provision a Nostr key —
   * the caller (A4.4's UI) is responsible for both user consent to
   * `confirmedRelays` and for having already run `userKey.ts`'s
   * provisioning flow; this returns `err('publishToNostr: no Nostr key
   * is provisioned...')` rather than silently provisioning one.
   *
   * Sequence (matters — see module doc): if the profile's
   * `alsoKnownAs` doesn't already carry this device's `nostr:npub…`
   * entry, it is added, the record is re-validated and RE-SIGNED (a
   * fresh Face-ID-gated `signCompact`, same as `saveProfile`) and
   * persisted BEFORE anything is published — a stale JWS (missing the
   * npub claim) must never reach a relay.
   */
  readonly publishToNostr: (confirmedRelays: readonly string[]) => Promise<Result<NostrPublishOutcome, string>>;
  /** Drop every live profile reference after the local store is wiped. */
  readonly resetForLocalWipe: () => void;
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  record: null,
  jws: null,
  status: 'empty',
  linkVisibility: [],
  shared: null,
  published: null,
  nostrPublishedJws: null,

  saveProfile: async (fields, options = {}) => {
    const generation = localWipeGeneration;
    const localDataEpoch = captureLocalDataEpoch();
    if (!canContinueProfileOperation(generation, localDataEpoch)) {
      return err('profile save cancelled by local wipe');
    }
    const didResult = await getRootDid();
    if (!canContinueProfileOperation(generation, localDataEpoch)) {
      return err('profile save cancelled by local wipe');
    }
    if (!didResult.ok) return err(rootKeyErrorMessage('profile save failed', didResult.error));

    const previous = get().record;
    const candidate = buildCandidateRecord(fields, options, previous, didResult.value);

    const validated = parseProfile(candidate);
    if (!validated.ok) return err(validated.error);

    const signerResult = await getRootSigner();
    if (!canContinueProfileOperation(generation, localDataEpoch)) {
      return err('profile save cancelled by local wipe');
    }
    if (!signerResult.ok) return err(rootKeyErrorMessage('profile save failed', signerResult.error));

    // The FULL record: source of truth, all links, `scope` left absent (= full)
    // for back-compat with pre-T7 persisted blobs / vectors and the Pear card.
    let jws: string;
    try {
      jws = await signCompact(validated.value, validated.value.did, signerResult.value);
    } catch (e) {
      return err(`profile save failed: signing was denied or failed (${e instanceof Error ? e.message : String(e)})`);
    }
    if (!canContinueProfileOperation(generation, localDataEpoch)) {
      return err('profile save cancelled by local wipe');
    }

    // Pre-sign the shared (QR) and public (Nostr) projections in the SAME
    // grace window so neither share path re-prompts Face ID later. Any denial
    // here aborts BEFORE anything is persisted — never a partial save.
    const linkVisibility = normalizeLinkVisibility(validated.value.links, fields.linkVisibility);
    const local: LocalProfile = { record: validated.value, linkVisibility };
    const projections = await signShareProjections(local, signerResult.value);
    if (!projections.ok) return err(`profile save failed: ${projections.error}`);
    if (!canContinueProfileOperation(generation, localDataEpoch)) {
      return err('profile save cancelled by local wipe');
    }

    const persisted = writePersisted({
      record: validated.value,
      jws,
      linkVisibility,
      shared: projections.value.shared,
      published: projections.value.published,
      nostrPublishedJws: null,
    }, localDataEpoch);
    if (persisted === 'storageFailure') {
      return err('profile save failed: local storage could not be updated');
    }
    if (persisted !== 'ok' || !canContinueProfileOperation(generation, localDataEpoch)) {
      return err('profile save cancelled by local wipe');
    }
    set({
      record: validated.value,
      jws,
      linkVisibility,
      shared: projections.value.shared,
      published: projections.value.published,
      nostrPublishedJws: null,
      status: 'ready',
    });
    // The record was re-signed — any published copy is now behind it, so the
    // cached verifications no longer describe this record. Clearing them makes
    // the checks re-run honestly (typically → stale) instead of seeding the
    // pre-edit state, which is the user's cue to republish. Both bindings are
    // cleared: an ATProto result left standing would keep painting a green
    // pill for a handle this record may no longer claim.
    invalidateCachedNostrResult();
    invalidateCachedAtprotoResult();
    return ok({ record: validated.value, jws });
  },

  savePageDesign: async (page) => {
    const localDataEpoch = captureLocalDataEpoch();
    if (!canCommitLocalData(localDataEpoch)) {
      return err('page save cancelled by local wipe');
    }
    const current = get();
    if (!current.record) return err('page save failed: no profile has been saved yet');
    return get().saveProfile(
      {
        displayName: current.record.displayName,
        bio: current.record.bio,
        links: current.record.links,
        linkVisibility: current.linkVisibility,
      },
      { page }
    );
  },

  publishToNostr: async (confirmedRelays) => {
    const generation = localWipeGeneration;
    const localDataEpoch = captureLocalDataEpoch();
    if (!canContinueProfileOperation(generation, localDataEpoch)) {
      return err('publishToNostr: cancelled by local wipe');
    }
    if (confirmedRelays.length === 0) return err('publishToNostr: relays list is empty');

    const current = get();
    if (!current.record || !current.jws) {
      return err('publishToNostr: no profile has been saved yet');
    }

    const pubkeyResult = await getNostrPubkey();
    if (!canContinueProfileOperation(generation, localDataEpoch)) {
      return err('publishToNostr: cancelled by local wipe');
    }
    if (!pubkeyResult.ok) {
      return err(
        pubkeyResult.error === 'notProvisioned'
          ? 'publishToNostr: no Nostr key is provisioned on this device yet'
          : `publishToNostr: ${pubkeyResult.error}`
      );
    }

    const npubResult = npubEncode(pubkeyResult.value);
    if (!npubResult.ok) return err(`publishToNostr: ${npubResult.error}`);
    const akaEntry = `nostr:${npubResult.value}`;

    let record = current.record;
    let jws = current.jws;
    let linkVisibility = current.linkVisibility;
    let published = current.published;

    // Only re-sign if the claim is actually missing — re-signing on every
    // publish would churn `updatedAt` for no reason once the binding is
    // already established. When it IS missing, the npub is merged into the
    // FULL record's alsoKnownAs and ALL THREE projections are re-signed (the
    // binding is identity-level, so the shared/public projections must
    // advertise it too), inside one biometric grace window.
    if (!record.alsoKnownAs.includes(akaEntry)) {
      const candidate = {
        ...record,
        alsoKnownAs: [...record.alsoKnownAs, akaEntry],
        updatedAt: nextUpdatedAt(record.updatedAt),
      };
      const validated = parseProfile(candidate);
      if (!validated.ok) return err(`publishToNostr: ${validated.error}`);

      const signerResult = await getRootSigner();
      if (!canContinueProfileOperation(generation, localDataEpoch)) {
        return err('publishToNostr: cancelled by local wipe');
      }
      if (!signerResult.ok) return err(rootKeyErrorMessage('publishToNostr', signerResult.error));

      try {
        jws = await signCompact(validated.value, validated.value.did, signerResult.value);
      } catch (e) {
        return err(`publishToNostr: signing was denied or failed (${e instanceof Error ? e.message : String(e)})`);
      }
      if (!canContinueProfileOperation(generation, localDataEpoch)) {
        return err('publishToNostr: cancelled by local wipe');
      }
      record = validated.value;
      linkVisibility = normalizeLinkVisibility(record.links, linkVisibility);
      const projections = await signShareProjections({ record, linkVisibility }, signerResult.value);
      if (!projections.ok) return err(`publishToNostr: ${projections.error}`);
      if (!canContinueProfileOperation(generation, localDataEpoch)) {
        return err('publishToNostr: cancelled by local wipe');
      }
      published = projections.value.published;

      const persisted = writePersisted({
        record,
        jws,
        linkVisibility,
        shared: projections.value.shared,
        published,
        nostrPublishedJws: null,
      }, localDataEpoch);
      if (persisted === 'storageFailure') {
        return err('publishToNostr: local storage could not be updated');
      }
      if (persisted !== 'ok' || !canContinueProfileOperation(generation, localDataEpoch)) {
        return err('publishToNostr: cancelled by local wipe');
      }
      set({
        record,
        jws,
        linkVisibility,
        shared: projections.value.shared,
        published,
        nostrPublishedJws: null,
        status: 'ready',
      });
    }

    // A pre-T7 profile hydrated with no cached public projection: sign it now
    // (one prompt) so we never publish the FULL record — which could carry
    // private links — to a relay.
    if (!published) {
      const signerResult = await getRootSigner();
      if (!canContinueProfileOperation(generation, localDataEpoch)) {
        return err('publishToNostr: cancelled by local wipe');
      }
      if (!signerResult.ok) return err(rootKeyErrorMessage('publishToNostr', signerResult.error));
      const publishedResult = await signProjection(
        { record, linkVisibility: normalizeLinkVisibility(record.links, linkVisibility) },
        'public',
        signerResult.value
      );
      if (!publishedResult.ok) return err(`publishToNostr: ${publishedResult.error}`);
      if (!canContinueProfileOperation(generation, localDataEpoch)) {
        return err('publishToNostr: cancelled by local wipe');
      }
      published = publishedResult.value;
      const persisted = writePersisted({
        record,
        jws,
        linkVisibility,
        shared: get().shared,
        published,
        nostrPublishedJws: null,
      }, localDataEpoch);
      if (persisted === 'storageFailure') {
        return err('publishToNostr: local storage could not be updated');
      }
      if (persisted !== 'ok' || !canContinueProfileOperation(generation, localDataEpoch)) {
        return err('publishToNostr: cancelled by local wipe');
      }
      set({ published, nostrPublishedJws: null });
    }

    // Publish the PUBLIC projection (scope:'public' — public-tier links only),
    // NEVER the full record: a link the user marked private/link-only must not
    // reach a public relay.
    if (!canContinueProfileOperation(generation, localDataEpoch)) {
      return err('publishToNostr: cancelled by local wipe');
    }
    const profileReport = await activePublishProfile({ jws: published.jws, relays: confirmedRelays });
    if (!canContinueProfileOperation(generation, localDataEpoch)) {
      return err('publishToNostr: cancelled by local wipe');
    }
    if (!profileReport.ok) return err(`publishToNostr: ${profileReport.error}`);

    const kind0Report = await activeUpdateKind0AlsoKnownAs({ did: record.did, relays: confirmedRelays });
    if (!canContinueProfileOperation(generation, localDataEpoch)) {
      return err('publishToNostr: cancelled by local wipe');
    }
    if (!kind0Report.ok) return err(`publishToNostr: ${kind0Report.error}`);

    // The kind-0 side just changed — a pre-publish cached verification must
    // not stand in for a live check for the rest of its TTL window.
    invalidateCachedNostrResult();

    const nostrPublishedJws = confirmedNostrPublishedJws(
      get().nostrPublishedJws,
      published.jws,
      profileReport.value,
      kind0Report.value
    );
    const persisted = writePersisted({
      record,
      jws,
      linkVisibility,
      shared: get().shared,
      published,
      nostrPublishedJws,
    }, localDataEpoch);
    if (persisted === 'storageFailure') {
      return err('publishToNostr: local storage could not be updated');
    }
    if (persisted !== 'ok' || !canContinueProfileOperation(generation, localDataEpoch)) {
      return err('publishToNostr: cancelled by local wipe');
    }
    set({ nostrPublishedJws });

    return ok({ profile: profileReport.value, kind0: kind0Report.value });
  },

  resetForLocalWipe: () => {
    localWipeGeneration += 1;
    set({
      record: null,
      jws: null,
      status: 'empty',
      linkVisibility: [],
      shared: null,
      published: null,
      nostrPublishedJws: null,
    });
  },
}));

/**
 * Swap in the persisted `(record, jws)` pair from MMKV. Call once from the
 * root layout after `initMmkv()` resolves — matches `hydratePreferences()` /
 * `seedFromManifest()`'s sync-on-boot pattern (CLAUDE.md rule 10). A no-op
 * (stays `'empty'`) if nothing has ever been saved, or if the persisted blob
 * fails validation.
 */
export function hydrateProfile(): void {
  const localDataEpoch = captureLocalDataEpoch();
  if (!canCommitLocalData(localDataEpoch)) return;
  const persisted = readPersisted();
  if (persisted && canCommitLocalData(localDataEpoch)) {
    useProfileStore.setState({
      record: persisted.record,
      jws: persisted.jws,
      linkVisibility: persisted.linkVisibility,
      shared: persisted.shared,
      published: persisted.published,
      nostrPublishedJws: persisted.nostrPublishedJws,
      status: 'ready',
    });
  }
}
