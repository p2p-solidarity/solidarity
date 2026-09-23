import {
  updateKind0AlsoKnownAs,
  type PublishReport,
  type UpdateKind0Options,
} from '@/nostr/publish';
import { registerNip05Name, type Nip05Registration } from '@/nip05/client';
import type { Result } from '@solidarity/shared';

export type PublicPageNamePublishResult =
  | { readonly status: 'ready'; readonly name: string; readonly identifier: string }
  | {
      readonly status: 'registered';
      readonly name: string;
      readonly identifier: string;
      readonly reason: 'kind0_publish_failed';
    }
  | { readonly status: 'nameTaken'; readonly name: string }
  | { readonly status: 'renameTooSoon'; readonly name: string; readonly retryAt?: number }
  | {
      readonly status: 'localOnly';
      readonly name: string;
      readonly reason:
        | 'profile_publish_failed'
        | 'directory_unreachable'
        | 'rate_limited'
        | 'invalid_auth'
        | 'invalid_request'
        | 'server_error';
    };

export interface PublishPublicPageNameOptions {
  readonly name: string;
  readonly did: string;
  readonly relays: readonly string[];
  readonly publishProfile: () => Promise<Result<{
    readonly profile: { readonly acceptedCount: number };
    readonly kind0: { readonly acceptedCount: number };
  }, string>>;
}

interface PublishPublicPageNameDependencies {
  readonly register?: (options: {
    readonly name: string;
    readonly relays: readonly string[];
  }) => Promise<Nip05Registration>;
  readonly updateKind0?: (
    options: UpdateKind0Options
  ) => Promise<Result<Pick<PublishReport, 'acceptedCount'>, string>>;
}

function localDirectoryFailure(
  name: string,
  error: Extract<Nip05Registration, { readonly ok: false }>['error']
): PublicPageNamePublishResult {
  const reason = error === 'unreachable' ? 'directory_unreachable' : error;
  if (
    reason === 'rate_limited' ||
    reason === 'invalid_auth' ||
    reason === 'invalid_request' ||
    reason === 'server_error' ||
    reason === 'directory_unreachable'
  ) {
    return { status: 'localOnly', name, reason };
  }
  return { status: 'localOnly', name, reason: 'server_error' };
}

/**
 * Publish in the only safe order for a public short name: signed profile
 * first, authenticated directory claim second, kind-0 reverse claim last.
 * The caller persists each returned state so a partial network failure never
 * makes an unpublished URL look ready.
 */
export async function publishPublicPageName(
  options: PublishPublicPageNameOptions,
  dependencies: PublishPublicPageNameDependencies = {}
): Promise<PublicPageNamePublishResult> {
  const name = options.name.trim().toLowerCase();
  const published = await options.publishProfile();
  if (
    !published.ok ||
    published.value.profile.acceptedCount < 1 ||
    published.value.kind0.acceptedCount < 1
  ) {
    return { status: 'localOnly', name, reason: 'profile_publish_failed' };
  }

  const registration = await (dependencies.register ?? registerNip05Name)({
    name,
    relays: options.relays,
  });
  if (!registration.ok) {
    if (registration.error === 'name_taken') return { status: 'nameTaken', name };
    if (registration.error === 'rename_too_soon') {
      return registration.retryAt === undefined
        ? { status: 'renameTooSoon', name }
        : { status: 'renameTooSoon', name, retryAt: registration.retryAt };
    }
    return localDirectoryFailure(name, registration.error);
  }

  const kind0 = await (dependencies.updateKind0 ?? updateKind0AlsoKnownAs)({
    did: options.did,
    nip05: registration.identifier,
    relays: options.relays,
  });
  if (!kind0.ok || kind0.value.acceptedCount < 1) {
    return {
      status: 'registered',
      name,
      identifier: registration.identifier,
      reason: 'kind0_publish_failed',
    };
  }

  return { status: 'ready', name, identifier: registration.identifier };
}
