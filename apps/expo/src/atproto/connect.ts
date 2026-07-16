/**
 * Headless post-OAuth ATProto connect service.
 *
 * Correctness hinges on one transaction order: construct the new at://
 * claim, pass it through the existing Face-ID-gated profile save, then put
 * only the JWS returned by that save. This module never reads the previous
 * profile JWS, so publishing it by mistake is impossible by construction.
 * A different existing ATProto claim returns a confirmation variant before
 * either signing or writing; UI is deliberately out of scope here.
 */
import { err, ok, type ProfileRecord, type Result } from '@solidarity/shared';

import type { ProfileEditableFields, ProfileSaveOptions, SavedProfile } from '@/profile/store';

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

export interface AtprotoConnectDependencies {
  readonly resolveIdentity: (handle: string) => Promise<Result<AtprotoIdentity, string>>;
  readonly readProfile: () => Promise<ProfileRecord | null>;
  readonly saveProfile: (
    fields: ProfileEditableFields,
    options: ProfileSaveOptions
  ) => Promise<Result<SavedProfile, string>>;
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
    return useProfileStore.getState().record;
  },
  saveProfile: async (fields, options) => {
    const { useProfileStore } = await import('@/profile/store');
    return useProfileStore.getState().saveProfile(fields, options);
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

function editableFields(profile: ProfileRecord): ProfileEditableFields {
  return {
    displayName: profile.displayName,
    bio: profile.bio,
    links: profile.links,
  };
}

function savedBindingMatches(saved: SavedProfile, expectedHandle: string): boolean {
  const handles = saved.record.alsoKnownAs
    .map(atprotoHandle)
    .filter((handle): handle is string => handle !== null);
  return handles.length === 1 && handles[0] === expectedHandle;
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

    const profile = await dependencies.readProfile();
    if (!profile) return err('profileMissing');

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
    const saved = await dependencies.saveProfile(editableFields(profile), {
      alsoKnownAs,
    });
    if (!saved.ok || !savedBindingMatches(saved.value, identity.value.handle)) {
      return err('profileSaveFailed');
    }

    const written = await dependencies.putProfileRecord(session, saved.value.jws);
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
