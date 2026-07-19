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
import { invalidateCachedNostrResult } from '@/badges/badgeStatusCache';
import { getRootDid, getRootSigner, type RootKeyError } from '@/identity/rootKey';
import { publishProfile, updateKind0AlsoKnownAs, type PublishReport } from '@/nostr/publish';
import { getNostrPubkey, npubEncode } from '@/nostr/userKey';
import { getMmkv } from '@/storage/mmkv';
import {
  PROFILE_VERSION,
  err,
  ok,
  parseProfile,
  signCompact,
  stableJSON,
  verifyCompact,
  type ProfileLink,
  type ProfileRecord,
  type Result,
} from '@solidarity/shared';

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

/** Test-only override. Pass `null` to restore the real relay-backed implementations. */
export function __setNostrPublishForTesting(
  overrides: { readonly publishProfile?: PublishProfileFn; readonly updateKind0AlsoKnownAs?: UpdateKind0Fn } | null
): void {
  activePublishProfile = overrides?.publishProfile ?? publishProfile;
  activeUpdateKind0AlsoKnownAs = overrides?.updateKind0AlsoKnownAs ?? updateKind0AlsoKnownAs;
}

export type ProfileStatus = 'empty' | 'ready';

/**
 * The text/link subset supplied on every editor save. Avatar and binding
 * changes use the narrow options below; remaining fields carry forward.
 */
export interface ProfileEditableFields {
  readonly displayName: string;
  readonly bio: string;
  readonly links: readonly ProfileLink[];
}

/** Narrow service-level overrides for signed binding and avatar flows. */
export interface ProfileSaveOptions {
  readonly alsoKnownAs?: readonly string[];
  readonly avatar?: string | null;
}

/** The exact pair persisted by a successful Face-ID-gated save. */
export interface SavedProfile {
  readonly record: ProfileRecord;
  readonly jws: string;
}

interface PersistedProfile {
  readonly record: ProfileRecord;
  readonly jws: string;
}

function readPersisted(): PersistedProfile | null {
  try {
    const raw = getMmkv().getString(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { record?: unknown; jws?: unknown };
    if (typeof parsed.jws !== 'string' || parsed.jws.length === 0) return null;
    // Re-validate on read, not just on write — a hand-edited or
    // schema-drifted MMKV blob must fail closed to 'empty', never hand a
    // screen a record that only LOOKS like a ProfileRecord.
    const validated = parseProfile(parsed.record);
    if (!validated.ok) return null;
    return { record: validated.value, jws: parsed.jws };
  } catch {
    return null;
  }
}

function writePersisted(p: PersistedProfile): void {
  try {
    getMmkv().set(KEY, JSON.stringify(p));
  } catch {
    // MMKV not ready / disk full — fail closed on the write; the in-memory
    // state the caller sets right after this still reflects the save for
    // the current session (matches preferences.ts's `writeSafe` policy).
  }
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

function avatarForSave(
  previous: string | null,
  override: string | null | undefined
): string | null {
  return override === undefined ? previous : override;
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

/** Combined publish outcome — both bindings of task A4.2's bidirectional pair. */
export interface NostrPublishOutcome {
  /** kind-30078 profile pointer (`content` = the profile JWS). */
  readonly profile: PublishReport;
  /** kind-0 metadata event with `did:key` merged into `content.alsoKnownAs`. */
  readonly kind0: PublishReport;
}

interface ProfileState {
  readonly record: ProfileRecord | null;
  readonly jws: string | null;
  readonly status: ProfileStatus;
  /**
   * Validate → (Face-ID) sign → persist, in that order. Returns
   * `err(reason)` without ever touching `getRootSigner()` (so without ever
   * prompting Face ID) when `fields` don't produce a valid `ProfileRecord`.
   */
  readonly saveProfile: (
    fields: ProfileEditableFields,
    options?: ProfileSaveOptions
  ) => Promise<Result<SavedProfile, string>>;
  /**
   * Adopt an already-root-signed `(record, jws)` pair as the current profile
   * WITHOUT re-signing — the persistence tail of the App↔Web webSign flow
   * (research §4 / G3): `approveWebSignRequest` has already Face-ID-gated and
   * root-signed the EXACT reviewed draft, so re-running `saveProfile` (which
   * mints a fresh record + fresh `updatedAt` and prompts Face ID again) would
   * both desync from the `responseJws` binding and double-prompt. This
   * re-validates the record shape and verifies the `jws` really is a root
   * signature over exactly that record (a defensive guard against a caller
   * wiring mistake — never a trust decision) before replacing the stored
   * pair, then invalidates the cached Nostr verification (a fresh record is
   * now ahead of any published copy). Synchronous: no biometric prompt, since
   * the signature already exists.
   */
  readonly adoptSignedProfile: (record: ProfileRecord, jws: string) => Result<SavedProfile, string>;
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
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  record: null,
  jws: null,
  status: 'empty',

  saveProfile: async (fields, options = {}) => {
    const didResult = await getRootDid();
    if (!didResult.ok) return err(rootKeyErrorMessage('profile save failed', didResult.error));

    const previous = get().record;
    const candidate = {
      v: PROFILE_VERSION,
      did: didResult.value,
      displayName: fields.displayName,
      avatar: avatarForSave(previous?.avatar ?? null, options.avatar),
      bio: fields.bio,
      links: fields.links,
      alsoKnownAs:
        options.alsoKnownAs !== undefined
          ? [...options.alsoKnownAs]
          : (previous?.alsoKnownAs ?? []),
      badges: previous?.badges ?? [],
      supersededBy: previous?.supersededBy ?? null,
      updatedAt: nextUpdatedAt(previous?.updatedAt ?? null),
    };

    const validated = parseProfile(candidate);
    if (!validated.ok) return err(validated.error);

    const signerResult = await getRootSigner();
    if (!signerResult.ok) return err(rootKeyErrorMessage('profile save failed', signerResult.error));

    let jws: string;
    try {
      jws = await signCompact(validated.value, validated.value.did, signerResult.value);
    } catch (e) {
      return err(`profile save failed: signing was denied or failed (${e instanceof Error ? e.message : String(e)})`);
    }

    writePersisted({ record: validated.value, jws });
    set({ record: validated.value, jws, status: 'ready' });
    // The record was re-signed — any published Nostr copy is now behind it,
    // so the cached verification no longer describes this record. Clearing
    // it makes the badge re-check honestly (typically → stale) instead of
    // seeding the pre-edit state, which is the user's cue to republish.
    invalidateCachedNostrResult();
    return ok({ record: validated.value, jws });
  },

  adoptSignedProfile: (record, jws) => {
    const validated = parseProfile(record);
    if (!validated.ok) return err(`adoptSignedProfile: ${validated.error}`);
    // The pair MUST be internally consistent: `jws` a root signature over
    // exactly this record. It always is when produced by
    // `approveWebSignRequest`; this only fails on a caller wiring bug, never
    // on a legitimate flow.
    const verified = verifyCompact(jws, validated.value.did);
    if (!verified.ok) return err(`adoptSignedProfile: ${verified.error}`);
    if (stableJSON(verified.value) !== stableJSON(validated.value)) {
      return err('adoptSignedProfile: signed payload differs from the record');
    }
    writePersisted({ record: validated.value, jws });
    set({ record: validated.value, jws, status: 'ready' });
    invalidateCachedNostrResult();
    return ok({ record: validated.value, jws });
  },

  publishToNostr: async (confirmedRelays) => {
    if (confirmedRelays.length === 0) return err('publishToNostr: relays list is empty');

    const current = get();
    if (!current.record || !current.jws) {
      return err('publishToNostr: no profile has been saved yet');
    }

    const pubkeyResult = await getNostrPubkey();
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

    // Only re-sign if the claim is actually missing — re-signing on every
    // publish would churn `updatedAt` for no reason once the binding is
    // already established.
    if (!record.alsoKnownAs.includes(akaEntry)) {
      const candidate = {
        ...record,
        alsoKnownAs: [...record.alsoKnownAs, akaEntry],
        updatedAt: nextUpdatedAt(record.updatedAt),
      };
      const validated = parseProfile(candidate);
      if (!validated.ok) return err(`publishToNostr: ${validated.error}`);

      const signerResult = await getRootSigner();
      if (!signerResult.ok) return err(rootKeyErrorMessage('publishToNostr', signerResult.error));

      try {
        jws = await signCompact(validated.value, validated.value.did, signerResult.value);
      } catch (e) {
        return err(`publishToNostr: signing was denied or failed (${e instanceof Error ? e.message : String(e)})`);
      }
      record = validated.value;

      writePersisted({ record, jws });
      set({ record, jws, status: 'ready' });
    }

    const profileReport = await activePublishProfile({ jws, relays: confirmedRelays });
    if (!profileReport.ok) return err(`publishToNostr: ${profileReport.error}`);

    const kind0Report = await activeUpdateKind0AlsoKnownAs({ did: record.did, relays: confirmedRelays });
    if (!kind0Report.ok) return err(`publishToNostr: ${kind0Report.error}`);

    // The kind-0 side just changed — a pre-publish cached verification must
    // not stand in for a live check for the rest of its TTL window.
    invalidateCachedNostrResult();

    return ok({ profile: profileReport.value, kind0: kind0Report.value });
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
  const persisted = readPersisted();
  if (persisted) {
    useProfileStore.setState({ record: persisted.record, jws: persisted.jws, status: 'ready' });
  }
}
