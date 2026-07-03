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
 * the caller, and every other field (`avatar`/`alsoKnownAs`/`badges`/
 * `supersededBy`) carried forward from the PREVIOUS stored record (or a
 * real empty default — `null`/`[]` — on the very first save, never a
 * fabricated placeholder; avatar upload is out of scope for this task, see
 * CLAUDE.md rule 8) — then validates, signs, and REPLACES the stored
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
import { getRootDid, getRootSigner, type RootKeyError } from '@/identity/rootKey';
import { getMmkv } from '@/storage/mmkv';
import {
  PROFILE_VERSION,
  err,
  ok,
  parseProfile,
  signCompact,
  type ProfileLink,
  type ProfileRecord,
  type Result,
} from '@solidarity/shared';

const KEY = 'profile:v1';

export type ProfileStatus = 'empty' | 'ready';

/**
 * The subset of Profile Record fields `app/me/edit.tsx` lets the user edit
 * today. Every other field (`avatar`/`alsoKnownAs`/`badges`/`supersededBy`)
 * is carried forward from the previously-stored record by `saveProfile` —
 * see the module doc's append-only note.
 */
export interface ProfileEditableFields {
  readonly displayName: string;
  readonly bio: string;
  readonly links: readonly ProfileLink[];
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

interface ProfileState {
  readonly record: ProfileRecord | null;
  readonly jws: string | null;
  readonly status: ProfileStatus;
  /**
   * Validate → (Face-ID) sign → persist, in that order. Returns
   * `err(reason)` without ever touching `getRootSigner()` (so without ever
   * prompting Face ID) when `fields` don't produce a valid `ProfileRecord`.
   */
  readonly saveProfile: (fields: ProfileEditableFields) => Promise<Result<void, string>>;
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  record: null,
  jws: null,
  status: 'empty',

  saveProfile: async (fields) => {
    const didResult = await getRootDid();
    if (!didResult.ok) return err(rootKeyErrorMessage('profile save failed', didResult.error));

    const previous = get().record;
    const candidate = {
      v: PROFILE_VERSION,
      did: didResult.value,
      displayName: fields.displayName,
      avatar: previous?.avatar ?? null,
      bio: fields.bio,
      links: fields.links,
      alsoKnownAs: previous?.alsoKnownAs ?? [],
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
    return ok(undefined);
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
