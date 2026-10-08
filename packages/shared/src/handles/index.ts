import { err } from '../types/result';

import { AtprotoHandleResolver } from './atproto';
import { DnsHandleResolver } from './dns';
import { EnsHandleResolver } from './ens';
import { Nip05HandleResolver } from './nip05';
import type {
  HandleResolutionOptions,
  HandleResolutionResult,
  HandleResolver,
  ResolverIO,
} from './types';

export * from './types';
export * from './atproto';
export * from './didPointer';
export * from './dns';
export * from './ens';
export * from './nip05';

/**
 * D7 remains syntactic, deterministic first-match-wins — no resolver is
 * network-probed and then silently skipped. `.eth` is the one reserved,
 * unambiguous suffix, so ENS precedes ATProto. ATProto otherwise retains
 * priority over DNS for backward compatibility: a bare `example.com` is
 * ATProto, while DNS uses `dns:example.com` or `{ schemeHint: 'dns' }`.
 */
export const DEFAULT_HANDLE_RESOLVERS: readonly HandleResolver[] = [
  new EnsHandleResolver(),
  new AtprotoHandleResolver(),
  new DnsHandleResolver(),
  new Nip05HandleResolver(),
];

export function matchHandleResolver(
  handle: string,
  resolvers: readonly HandleResolver[],
  options: HandleResolutionOptions = {}
): HandleResolver | undefined {
  return resolvers.find((candidate) => {
    if (options.schemeHint !== undefined && candidate.scheme !== options.schemeHint) return false;
    try {
      return candidate.matches(handle);
    } catch {
      return false;
    }
  });
}

export async function resolveHandle(
  handle: string,
  resolvers: readonly HandleResolver[],
  io: ResolverIO,
  options: HandleResolutionOptions = {}
): Promise<HandleResolutionResult> {
  const resolver = matchHandleResolver(handle, resolvers, options);
  if (resolver === undefined) return err('unsupportedHandle');
  try {
    return await resolver.resolve(handle, io);
  } catch {
    return err('unreachable');
  }
}
