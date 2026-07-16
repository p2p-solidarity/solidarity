import { err } from '../types/result';

import type { HandleResolutionResult, HandleResolver, ResolverIO } from './types';

export * from './types';
export * from './atproto';

export async function resolveHandle(
  handle: string,
  resolvers: readonly HandleResolver[],
  io: ResolverIO
): Promise<HandleResolutionResult> {
  const resolver = resolvers.find((candidate) => {
    try {
      return candidate.matches(handle);
    } catch {
      return false;
    }
  });
  if (resolver === undefined) return err('unsupportedHandle');
  try {
    return await resolver.resolve(handle, io);
  } catch {
    return err('unreachable');
  }
}
