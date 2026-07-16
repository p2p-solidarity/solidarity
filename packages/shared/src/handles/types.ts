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
}

export type HandleResolutionError =
  | 'unsupportedHandle'
  | 'invalidHandle'
  | 'notFound'
  | 'unreachable'
  | 'insecureEndpoint'
  | 'malformedDid';

export type HandleResolutionResult = Result<{ readonly did: string }, HandleResolutionError>;

export interface HandleResolver {
  readonly scheme: HandleScheme;
  matches(handle: string): boolean;
  resolve(handle: string, io: ResolverIO): Promise<HandleResolutionResult>;
}
