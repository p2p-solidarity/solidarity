/**
 * Headless Bluesky wizard orchestration.
 *
 * The UI only receives kind-keyed failures, never raw OAuth/server strings.
 * A replacement carries only a non-secret identity pin; confirmation reloads
 * the persisted session and rejects any account swap before continuing.
 * Successful completion includes the shared verifier's exact state; this layer never
 * upgrades a one-way or unreachable binding to "verified".
 */
import {
  err,
  isValidAtprotoHandle,
  ok,
  type ProfileRecord,
  type Result,
  type VerifyAtprotoBindingResult,
} from '@solidarity/shared';

import type { AtprotoConnectError, AtprotoConnectOptions, AtprotoConnectOutcome } from './connect';
import type { StartAtprotoOAuthOpts } from './oauth';
import type { AtprotoSession } from './session';

export type BlueskyWizardErrorKind =
  | 'invalidHandle'
  | 'oauthCancelled'
  | 'clientMetadataUnavailable'
  | 'networkUnavailable'
  | 'oauthFailed'
  | 'verificationFailed'
  | AtprotoConnectError;

export interface BlueskyWizardError {
  readonly kind: BlueskyWizardErrorKind;
}

export interface BlueskyConnectedOutcome {
  readonly kind: 'connected';
  readonly handle: string;
  readonly repoDid: string;
  readonly verification: VerifyAtprotoBindingResult;
}

export interface BlueskyReplacementOutcome {
  readonly kind: 'replacementConfirmationRequired';
  readonly existingHandle: string;
  readonly replacementHandle: string;
  /** Non-secret identity pin used to reject a session swap while the dialog is open. */
  readonly sessionIdentity: Pick<AtprotoSession, 'did' | 'handle' | 'pdsUrl'>;
}

export type BlueskyWizardOutcome = BlueskyConnectedOutcome | BlueskyReplacementOutcome;

type StartOAuth = (
  handle: string,
  options?: StartAtprotoOAuthOpts
) => Promise<Result<AtprotoSession, string>>;
type Connect = (
  session: AtprotoSession,
  options: AtprotoConnectOptions
) => Promise<Result<AtprotoConnectOutcome, AtprotoConnectError>>;

export interface BlueskyWizardDependencies {
  readonly startOAuth: StartOAuth;
  readonly connect: Connect;
  readonly getSession: () => Promise<Result<AtprotoSession | null, string>>;
  readonly readProfile: () => Promise<ProfileRecord | null>;
  readonly verifyBinding: (profile: ProfileRecord) => Promise<VerifyAtprotoBindingResult>;
}

const DEFAULT_DEPENDENCIES: BlueskyWizardDependencies = {
  startOAuth: async (handle, options) => {
    const { startAtprotoOAuth } = await import('./oauth');
    return await startAtprotoOAuth(handle, options);
  },
  connect: async (session, options) => {
    const { connectAtproto } = await import('./connect');
    return await connectAtproto(session, options);
  },
  getSession: async () => {
    const { getAtprotoSession } = await import('./oauth');
    return await getAtprotoSession();
  },
  readProfile: async () => {
    const { useProfileStore } = await import('@/profile/store');
    return useProfileStore.getState().record;
  },
  verifyBinding: async (profile) => {
    const [{ atprotoBindingIO }, { verifyAtprotoBindingDual }, { useProfileStore }] =
      await Promise.all([
        import('./bindingIo'),
        import('@/badges/verifyAtprotoDual'),
        import('@/profile/store'),
      ]);
    // The PDS may hold either the public projection (current connects) or a
    // pre-projection full record — dual-compare so neither reads as a false
    // "declared" right after a successful connect.
    const published = useProfileStore.getState().published;
    return await verifyAtprotoBindingDual(profile, published?.record ?? null, atprotoBindingIO);
  },
};

export function normalizeBlueskyHandle(input: string): string {
  const normalized = input.trim().toLowerCase();
  const withoutAt = normalized.startsWith('@') ? normalized.slice(1) : normalized;
  if (withoutAt.length === 0 || withoutAt.includes('.')) return withoutAt;
  return `${withoutAt}.bsky.social`;
}

/** Collapse potentially sensitive transport text into stable UI-safe kinds. */
export function classifyAtprotoOAuthError(message: string): BlueskyWizardError {
  const normalized = message.toLowerCase();
  if (
    normalized.includes('cancel') ||
    normalized.includes('access_denied') ||
    normalized.includes('ended without a result')
  ) {
    return { kind: 'oauthCancelled' };
  }
  if (
    normalized.includes('invalid_client') ||
    normalized.includes('client metadata') ||
    normalized.includes('client_id') ||
    normalized.includes('client-id')
  ) {
    return { kind: 'clientMetadataUnavailable' };
  }
  if (
    normalized.includes('network') ||
    normalized.includes('unreachable') ||
    normalized.includes('timed out') ||
    normalized.includes('timeout') ||
    normalized.includes('fetch')
  ) {
    return { kind: 'networkUnavailable' };
  }
  return { kind: 'oauthFailed' };
}

async function finishConnection(
  session: AtprotoSession,
  options: AtprotoConnectOptions,
  dependencies: BlueskyWizardDependencies
): Promise<Result<BlueskyWizardOutcome, BlueskyWizardError>> {
  let connected: Result<AtprotoConnectOutcome, AtprotoConnectError>;
  try {
    connected = await dependencies.connect(session, options);
  } catch {
    return err({ kind: 'recordWriteFailed' });
  }
  if (!connected.ok) return err({ kind: connected.error });
  if (connected.value.kind === 'replacementConfirmationRequired') {
    const { did, handle, pdsUrl } = session;
    return ok({ ...connected.value, sessionIdentity: { did, handle, pdsUrl } });
  }

  try {
    const profile = await dependencies.readProfile();
    if (profile === null) return err({ kind: 'profileMissing' });
    const verification = await dependencies.verifyBinding(profile);
    return ok({ ...connected.value, verification });
  } catch {
    return err({ kind: 'verificationFailed' });
  }
}

export async function beginBlueskyConnect(
  input: string,
  oauthOptions: StartAtprotoOAuthOpts = {},
  dependencies: BlueskyWizardDependencies = DEFAULT_DEPENDENCIES
): Promise<Result<BlueskyWizardOutcome, BlueskyWizardError>> {
  const handle = normalizeBlueskyHandle(input);
  if (!isValidAtprotoHandle(handle)) return err({ kind: 'invalidHandle' });

  try {
    const session = await dependencies.startOAuth(handle, oauthOptions);
    if (!session.ok) return err(classifyAtprotoOAuthError(session.error));
    return await finishConnection(session.value, {}, dependencies);
  } catch {
    return err({ kind: 'oauthFailed' });
  }
}

export async function confirmBlueskyReplacement(
  replacement: BlueskyReplacementOutcome,
  dependencies: BlueskyWizardDependencies = DEFAULT_DEPENDENCIES
): Promise<Result<BlueskyWizardOutcome, BlueskyWizardError>> {
  let persisted: Result<AtprotoSession | null, string>;
  try {
    persisted = await dependencies.getSession();
  } catch {
    return err({ kind: 'oauthFailed' });
  }
  if (!persisted.ok || persisted.value === null) return err({ kind: 'oauthFailed' });
  const expected = replacement.sessionIdentity;
  if (
    persisted.value.did !== expected.did ||
    persisted.value.handle !== expected.handle ||
    persisted.value.pdsUrl !== expected.pdsUrl
  ) {
    return err({ kind: 'sessionIdentityMismatch' });
  }
  return await finishConnection(persisted.value, { confirmReplacement: true }, dependencies);
}
