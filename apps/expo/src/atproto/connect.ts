/**
 * Headless post-OAuth ATProto connect service.
 *
 * Correctness hinges on one transaction order: construct the new at://
 * claim, pass it through the existing Face-ID-gated profile save while
 * preserving local link visibility, then put only that save's PUBLIC
 * projection. This module never uploads the full source-of-truth JWS.
 * A different existing ATProto claim returns a confirmation variant before
 * either signing or writing; UI is deliberately out of scope here.
 */
import { err, ok, type ProfileRecord, type Result } from '@solidarity/shared';

import type {
  ProfileEditableFields,
  ProfileSaveOptions,
  SavedProfile,
  SignedProjection,
} from '@/profile/store';
import type { LinkVisibility } from '@/profile/projection';

import { resolveAtprotoIdentity, type AtprotoIdentity } from './discovery';
import { signOutAtproto } from './oauth';
import { putProfileRecord, type PdsWriteError } from './pds';
import type { AtprotoSession } from './session';

const ATPROTO_ALIAS_PREFIX = 'at://';

export type AtprotoConnectError =
  | 'identityResolutionFailed'
  | 'sessionIdentityMismatch'
  | 'profileMissing'
  | 'profileSaveFailed'
  | 'recordWriteFailed';

export type AtprotoConnectOutcome =
  | {
      readonly kind: 'connected';
      readonly handle: string;
      readonly repoDid: string;
    }
  | {
      readonly kind: 'replacementConfirmationRequired';
      readonly existingHandle: string;
      readonly replacementHandle: string;
    };

export interface AtprotoConnectOptions {
  /** Set only after the UI has confirmed replacing a different at:// claim. */
  readonly confirmReplacement?: boolean;
}

export interface AtprotoProfileDraft {
  readonly record: ProfileRecord;
  readonly linkVisibility: readonly LinkVisibility[];
}

export interface SavedAtprotoProfile extends SavedProfile {
  readonly published: SignedProjection;
}

export interface AtprotoConnectDependencies {
  readonly resolveIdentity: (handle: string) => Promise<Result<AtprotoIdentity, string>>;
  readonly readProfile: () => Promise<AtprotoProfileDraft | null>;
  readonly saveProfile: (
    fields: ProfileEditableFields,
    options: ProfileSaveOptions
  ) => Promise<Result<SavedAtprotoProfile, string>>;
  readonly putProfileRecord: (
    session: AtprotoSession,
    jws: string
  ) => Promise<Result<void, PdsWriteError>>;
}

export interface AtprotoDisconnectDependencies {
  readonly clearSession: () => Promise<Result<void, string>>;
}

const DEFAULT_DEPENDENCIES: AtprotoConnectDependencies = {
  resolveIdentity: resolveAtprotoIdentity,
  readProfile: async () => {
    const { useProfileStore } = await import('@/profile/store');
    const state = useProfileStore.getState();
    return state.record === null
      ? null
      : { record: state.record, linkVisibility: state.linkVisibility };
  },
  saveProfile: async (fields, options) => {
    const { useProfileStore } = await import('@/profile/store');
    const saved = await useProfileStore.getState().saveProfile(fields, options);
    if (!saved.ok) return saved;
    const published = useProfileStore.getState().published;
    return published === null
      ? err('profile save produced no public projection')
      : ok({ ...saved.value, published });
  },
  putProfileRecord,
};

const DEFAULT_DISCONNECT_DEPENDENCIES: AtprotoDisconnectDependencies = {
  clearSession: signOutAtproto,
};

function atprotoHandle(alias: string): string | null {
  return alias.startsWith(ATPROTO_ALIAS_PREFIX) ? alias.slice(ATPROTO_ALIAS_PREFIX.length) : null;
}

function replaceAtprotoAlias(aliases: readonly string[], handle: string): readonly string[] {
  const replacement = `${ATPROTO_ALIAS_PREFIX}${handle}`;
  const next: string[] = [];
  let inserted = false;
  for (const alias of aliases) {
    if (atprotoHandle(alias) === null) {
      next.push(alias);
    } else if (!inserted) {
      next.push(replacement);
      inserted = true;
    }
  }
  if (!inserted) next.push(replacement);
  return next;
}

function editableFields(profile: AtprotoProfileDraft): ProfileEditableFields {
  return {
    displayName: profile.record.displayName,
    bio: profile.record.bio,
    links: profile.record.links,
    linkVisibility: profile.linkVisibility,
  };
}

function recordBindingMatches(record: ProfileRecord, expectedHandle: string): boolean {
  const handles = record.alsoKnownAs
    .map(atprotoHandle)
    .filter((handle): handle is string => handle !== null);
  return handles.length === 1 && handles[0] === expectedHandle;
}

function savedBindingMatches(saved: SavedAtprotoProfile, expectedHandle: string): boolean {
  return (
    recordBindingMatches(saved.record, expectedHandle) &&
    recordBindingMatches(saved.published.record, expectedHandle) &&
    saved.published.record.scope === 'public' &&
    saved.published.record.did === saved.record.did &&
    saved.published.record.updatedAt === saved.record.updatedAt
  );
}

function identityMatchesSession(identity: AtprotoIdentity, session: AtprotoSession): boolean {
  return (
    identity.did === session.did &&
    identity.handle === session.handle.trim().toLowerCase() &&
    identity.pdsUrl === session.pdsUrl
  );
}

/** Complete the public binding after OAuth has returned a session. */
export async function connectAtproto(
  session: AtprotoSession,
  options: AtprotoConnectOptions = {},
  dependencies: AtprotoConnectDependencies = DEFAULT_DEPENDENCIES
): Promise<Result<AtprotoConnectOutcome, AtprotoConnectError>> {
  try {
    const identity = await dependencies.resolveIdentity(session.handle);
    if (!identity.ok) return err('identityResolutionFailed');
    if (!identityMatchesSession(identity.value, session)) {
      return err('sessionIdentityMismatch');
    }

    const draft = await dependencies.readProfile();
    if (!draft) return err('profileMissing');
    const profile = draft.record;

    const existingHandles = profile.alsoKnownAs
      .map(atprotoHandle)
      .filter((handle): handle is string => handle !== null);
    const differentHandle = existingHandles.find((handle) => handle !== identity.value.handle);
    if (differentHandle !== undefined && !options.confirmReplacement) {
      return ok({
        kind: 'replacementConfirmationRequired',
        existingHandle: differentHandle,
        replacementHandle: identity.value.handle,
      });
    }

    const alsoKnownAs = replaceAtprotoAlias(profile.alsoKnownAs, identity.value.handle);
    const saved = await dependencies.saveProfile(editableFields(draft), {
      alsoKnownAs,
    });
    if (!saved.ok || !savedBindingMatches(saved.value, identity.value.handle)) {
      return err('profileSaveFailed');
    }

    const written = await dependencies.putProfileRecord(session, saved.value.published.jws);
    if (!written.ok) return err('recordWriteFailed');

    return ok({
      kind: 'connected',
      handle: identity.value.handle,
      repoDid: identity.value.did,
    });
  } catch {
    return err('recordWriteFailed');
  }
}

/** Local disconnect only; the signed profile and public PDS record remain. */
export async function disconnectAtproto(
  dependencies: AtprotoDisconnectDependencies = DEFAULT_DISCONNECT_DEPENDENCIES
): Promise<Result<void, 'sessionClearFailed'>> {
  try {
    const result = await dependencies.clearSession();
    return result.ok ? ok(undefined) : err('sessionClearFailed');
  } catch {
    return err('sessionClearFailed');
  }
}
