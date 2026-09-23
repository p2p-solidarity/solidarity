import type { Result } from '../types/result';

export type HandleScheme = 'atproto' | 'ens' | 'dns' | 'nip05';

/**
 * `notFound` is an observed empty/404 response; `unreachable` means the
 * check could not complete. Badge verifiers depend on that distinction to
 * choose declared vs stale honestly.
 */
export type ResolverIoError = 'notFound' | 'unreachable' | 'insecureEndpoint';

/** Pure IO boundary implemented separately by app and web consumers. */
export interface ResolverIO {
  readonly fetchText: (url: string) => Promise<Result<string | null, ResolverIoError>>;
  readonly dnsTxt: (name: string) => Promise<Result<readonly string[], ResolverIoError>>;
  /** Optional because ENS is a soft dependency for app/web consumers. */
  readonly ethCall?: (to: string, data: string) => Promise<Result<string, ResolverIoError>>;
}

export interface NostrProfileSource {
  readonly kind: 'nostr';
  readonly npub: string;
}

/** Add future retrieval transports as new members without changing resolvers. */
export type ProfileSource = NostrProfileSource;

export type HandleResolutionError =
  | 'unsupportedHandle'
  | 'invalidHandle'
  | 'notFound'
  | 'unreachable'
  | 'insecureEndpoint'
  | 'malformedDid'
  | 'conflictingRecords';

export interface DidHandleResolutionValue {
  /** Optional for backward compatibility with the original DID-only resolver shape. */
  readonly kind?: 'did';
  readonly did: string;
  readonly sources?: readonly ProfileSource[];
}

export interface ActiveNip05HandleResolutionValue {
  readonly kind: 'nip05';
  readonly status: 'active';
  readonly name: string;
  readonly identifier: string;
  readonly pubkey: string;
  readonly npub: string;
  readonly relays: readonly string[];
  readonly sources: readonly [NostrProfileSource];
  readonly rebindGeneration: number;
  readonly reboundAt: number | null;
}

export interface RedirectedNip05HandleResolutionValue {
  readonly kind: 'nip05';
  readonly status: 'redirected';
  readonly name: string;
  readonly identifier: string;
  readonly redirectTo: string;
  readonly redirectUntil: number;
  readonly rebindGeneration: number;
  readonly reboundAt: number | null;
}

export type Nip05HandleResolutionValue =
  | ActiveNip05HandleResolutionValue
  | RedirectedNip05HandleResolutionValue;

export type HandleResolutionValue = DidHandleResolutionValue | Nip05HandleResolutionValue;

export function isNip05HandleResolutionValue(
  value: HandleResolutionValue
): value is Nip05HandleResolutionValue {
  return value.kind === 'nip05';
}

export type HandleResolutionResult = Result<HandleResolutionValue, HandleResolutionError>;

export interface HandleResolutionOptions {
  /** Select an otherwise-ambiguous syntactic resolver without network probing. */
  readonly schemeHint?: HandleScheme;
}

export interface HandleResolver {
  readonly scheme: HandleScheme;
  matches(handle: string): boolean;
  resolve(handle: string, io: ResolverIO): Promise<HandleResolutionResult>;
}
