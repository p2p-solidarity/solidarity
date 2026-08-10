/** Truth selection shared by onboarding's Connect and Complete steps. */
import {
  verifyNostrBinding,
  type BadgeState,
  type ProfileRecord,
  type VerifyAtprotoBindingResult,
  type VerifyNostrBindingResult,
} from '@solidarity/shared';

export type OnboardingBadgeProvider = 'bluesky' | 'nostr';

export type OnboardingBadgeResult =
  | { readonly provider: 'bluesky'; readonly result: VerifyAtprotoBindingResult }
  | { readonly provider: 'nostr'; readonly result: VerifyNostrBindingResult };

export interface OnboardingBadgeVerificationDependencies {
  readonly verifyAtproto: (profile: ProfileRecord) => Promise<VerifyAtprotoBindingResult>;
  readonly verifyNostr: (profile: ProfileRecord) => Promise<VerifyNostrBindingResult>;
}

const DEFAULT_DEPENDENCIES: OnboardingBadgeVerificationDependencies = {
  // Completed onboarding checks also land in badgeStatusCache: the Me tab
  // trusts a fresh cached result (shouldReverifyBadge TTL), so a check the
  // user just watched here is not silently repeated on first tab focus.
  verifyAtproto: async (profile) => {
    const [
      { atprotoBindingIO },
      { verifyAtprotoBindingDual },
      { useProfileStore },
      { captureBadgeStatusCacheEpoch },
    ] =
      await Promise.all([
        import('@/atproto/bindingIo'),
        import('@/badges/verifyAtprotoDual'),
        import('@/profile/store'),
        import('@/badges/badgeStatusCache'),
      ]);
    const verificationEpoch = captureBadgeStatusCacheEpoch();
    // Dual-compare (public projection first, full-record fallback) so a
    // pre-projection PDS copy never writes a false "declared" into the
    // shared badge cache that Me would then trust for a full TTL.
    const published = useProfileStore.getState().published;
    const result = await verifyAtprotoBindingDual(
      profile,
      published?.record ?? null,
      atprotoBindingIO
    );
    const { writeCachedAtprotoResult } = await import('@/badges/badgeStatusCache');
    writeCachedAtprotoResult(result, Date.now(), verificationEpoch);
    return result;
  },
  verifyNostr: async (profile) => {
    const [
      { makeKind0Fetcher },
      { DEFAULT_RELAYS },
      { captureBadgeStatusCacheEpoch },
    ] = await Promise.all([
      import('@/nostr/fetchKind0'),
      import('@/nostr/publish'),
      import('@/badges/badgeStatusCache'),
    ]);
    const verificationEpoch = captureBadgeStatusCacheEpoch();
    const result = await verifyNostrBinding(profile, makeKind0Fetcher(DEFAULT_RELAYS));
    const { writeCachedNostrResult } = await import('@/badges/badgeStatusCache');
    writeCachedNostrResult(result, Date.now(), verificationEpoch);
    return result;
  },
};

export function claimedBadgeProviders(profile: ProfileRecord): readonly OnboardingBadgeProvider[] {
  const providers: OnboardingBadgeProvider[] = [];
  if (profile.alsoKnownAs.some((alias) => alias.startsWith('at://'))) providers.push('bluesky');
  if (profile.alsoKnownAs.some((alias) => alias.startsWith('nostr:npub'))) providers.push('nostr');
  return providers;
}

function stateRank(state: BadgeState): number {
  switch (state) {
    case 'verified':
      return 3;
    case 'declared':
      return 2;
    case 'stale':
      return 1;
    case 'revoked':
      return 0;
  }
}

async function verifyProvider(
  profile: ProfileRecord,
  provider: OnboardingBadgeProvider,
  dependencies: OnboardingBadgeVerificationDependencies
): Promise<OnboardingBadgeResult> {
  if (provider === 'bluesky') {
    return { provider, result: await dependencies.verifyAtproto(profile) };
  }
  return { provider, result: await dependencies.verifyNostr(profile) };
}

/**
 * A provider explicitly chosen in this run wins when it has a real claim.
 * Replay has no hint, so it prefers the strongest verifier evidence and
 * uses Bluesky only as the equal-state tie-break from D5.
 */
export async function verifyOnboardingBadge(
  profile: ProfileRecord,
  preferredProvider: OnboardingBadgeProvider | null,
  dependencies: OnboardingBadgeVerificationDependencies = DEFAULT_DEPENDENCIES
): Promise<OnboardingBadgeResult | null> {
  const claimed = claimedBadgeProviders(profile);
  if (claimed.length === 0) return null;

  if (preferredProvider !== null && claimed.includes(preferredProvider)) {
    return await verifyProvider(profile, preferredProvider, dependencies);
  }

  const results = await Promise.all(
    claimed.map((provider) => verifyProvider(profile, provider, dependencies))
  );
  return (
    results.sort((left, right) => {
      const stateDifference = stateRank(right.result.state) - stateRank(left.result.state);
      if (stateDifference !== 0) return stateDifference;
      return left.provider === 'bluesky' ? -1 : 1;
    })[0] ?? null
  );
}

/** Warm verifier evidence is renderable only while its public claim remains current. */
export function badgeResultMatchesProfile(
  badge: OnboardingBadgeResult,
  profile: ProfileRecord,
  preferredProvider: OnboardingBadgeProvider | null = null
): boolean {
  const claimed = claimedBadgeProviders(profile);
  if (
    preferredProvider !== null &&
    claimed.includes(preferredProvider) &&
    badge.provider !== preferredProvider
  ) {
    return false;
  }
  if (badge.provider === 'bluesky') {
    const handle = badge.result.evidence.handleClaim;
    return handle !== null && profile.alsoKnownAs.includes(`at://${handle}`);
  }
  return badge.result.npub !== null && profile.alsoKnownAs.includes(`nostr:${badge.result.npub}`);
}
