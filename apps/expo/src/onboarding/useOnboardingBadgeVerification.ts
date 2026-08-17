import { useEffect, useRef, useState } from 'react';

import type { ProfileRecord } from '@solidarity/shared';

import {
  badgeResultMatchesProfile,
  claimedBadgeProviders,
  verifyOnboardingBadge,
  type OnboardingBadgeProvider,
  type OnboardingBadgeResult,
} from './badgeVerification';

export type OnboardingBadgeCheckState =
  | { readonly status: 'unbound'; readonly result: null }
  | { readonly status: 'checking'; readonly result: OnboardingBadgeResult | null }
  | { readonly status: 'ready'; readonly result: OnboardingBadgeResult }
  | { readonly status: 'error'; readonly result: OnboardingBadgeResult | null };

interface Snapshot {
  readonly key: string;
  readonly state: OnboardingBadgeCheckState;
}

function verificationKey(
  profile: ProfileRecord | null,
  preferredProvider: OnboardingBadgeProvider | null
): string {
  if (profile === null) return `empty:${preferredProvider ?? 'none'}`;
  return `${profile.did}:${profile.updatedAt}:${profile.alsoKnownAs.join('|')}:${preferredProvider ?? 'none'}`;
}

function initialState(
  profile: ProfileRecord | null,
  warmResult: OnboardingBadgeResult | null,
  preferredProvider: OnboardingBadgeProvider | null
): OnboardingBadgeCheckState {
  if (profile === null || claimedBadgeProviders(profile).length === 0) {
    return { status: 'unbound', result: null };
  }
  const warm =
    warmResult !== null && badgeResultMatchesProfile(warmResult, profile, preferredProvider)
      ? warmResult
      : null;
  return { status: 'checking', result: warm };
}

/** No await gates first paint: claims and warm evidence are mirrored synchronously. */
export function useOnboardingBadgeVerification(
  profile: ProfileRecord | null,
  preferredProvider: OnboardingBadgeProvider | null,
  warmResult: OnboardingBadgeResult | null,
  onResult?: (result: OnboardingBadgeResult | null) => void
): OnboardingBadgeCheckState {
  const key = verificationKey(profile, preferredProvider);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const warmResultRef = useRef(warmResult);
  warmResultRef.current = warmResult;
  const [snapshot, setSnapshot] = useState<Snapshot>(() => ({
    key,
    state: initialState(profile, warmResult, preferredProvider),
  }));
  const visibleState =
    snapshot.key === key ? snapshot.state : initialState(profile, warmResult, preferredProvider);

  useEffect(() => {
    let cancelled = false;
    const firstState = initialState(profile, warmResultRef.current, preferredProvider);
    setSnapshot({ key, state: firstState });

    if (profile === null || firstState.status === 'unbound') {
      onResultRef.current?.(null);
      return () => {
        cancelled = true;
      };
    }

    void verifyOnboardingBadge(profile, preferredProvider)
      .then((result) => {
        if (cancelled) return;
        if (result === null) {
          setSnapshot({ key, state: { status: 'unbound', result: null } });
        } else {
          setSnapshot({ key, state: { status: 'ready', result } });
        }
        onResultRef.current?.(result);
      })
      .catch(() => {
        if (cancelled) return;
        if (firstState.status === 'checking' && firstState.result === null) {
          onResultRef.current?.(null);
        }
        setSnapshot({
          key,
          state: {
            status: 'error',
            result: firstState.status === 'checking' ? firstState.result : null,
          },
        });
      });

    return () => {
      cancelled = true;
    };
  }, [key, preferredProvider, profile]);

  return visibleState;
}
