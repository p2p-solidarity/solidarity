import type { ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut } from 'react-native-reanimated';

import { atprotoBadgeViewModel } from '@/badges/atprotoBadgeDisplay';
import { nostrBadgeViewModel } from '@/badges/nostrBadgeDisplay';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';
import type {
  OnboardingBadgeProvider,
  OnboardingBadgeResult,
} from '@/onboarding/badgeVerification';

const BADGE_CROSSFADE_MS = 200;

type BadgeVisual = 'loading' | 'verified' | 'declared' | 'stale';

export interface BindingBadgeChipProps {
  readonly result: OnboardingBadgeResult | null;
  readonly isChecking?: boolean;
  readonly providerHint?: OnboardingBadgeProvider | null;
  readonly animateStateChange?: boolean;
}

export function BindingBadgeChip({
  result,
  isChecking = false,
  providerHint = null,
  animateStateChange = true,
}: BindingBadgeChipProps): ReactNode {
  const { t } = useTranslation();
  const provider = result?.provider ?? providerHint;
  if (provider === null) return null;

  const visual = badgeVisual(result, isChecking);
  if (visual === null) return null;
  const label = t(badgeLabelKey(provider, visual));
  const body = <BadgeChipBody visual={visual} label={label} />;

  return (
    <ThemedSurface
      variant="inset"
      className="self-start rounded-none px-3 py-2"
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      style={{ borderWidth: 1, borderColor: Colors.divider }}>
      <BadgeStateTransition enabled={animateStateChange} transitionKey={`${provider}-${visual}`}>
        {body}
      </BadgeStateTransition>
    </ThemedSurface>
  );
}

function BadgeStateTransition({
  enabled,
  transitionKey,
  children,
}: {
  readonly enabled: boolean;
  readonly transitionKey: string;
  readonly children: ReactNode;
}): ReactNode {
  if (!enabled) return children;
  return (
    <Animated.View
      key={transitionKey}
      entering={FadeIn.duration(BADGE_CROSSFADE_MS).easing(Easing.out(Easing.quad))}
      exiting={FadeOut.duration(BADGE_CROSSFADE_MS).easing(Easing.out(Easing.quad))}>
      {children}
    </Animated.View>
  );
}

function BadgeChipBody({
  visual,
  label,
}: {
  readonly visual: BadgeVisual;
  readonly label: string;
}) {
  if (visual === 'loading') {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <ActivityIndicator size="small" color={Colors.text3} />
        <ThemedText variant="label" tone="tertiary">
          {label}
        </ThemedText>
      </View>
    );
  }

  const style = badgeVisualStyle(visual);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
      <SfIcon name={style.icon} size={15} color={style.color} />
      <ThemedText variant="label" style={{ color: style.color }}>
        {label}
      </ThemedText>
    </View>
  );
}

function badgeLabelKey(provider: OnboardingBadgeProvider, visual: BadgeVisual): string {
  const namespace = provider === 'bluesky' ? 'atproto' : 'nostr';
  switch (visual) {
    case 'loading':
      return `badges.${namespace}.checking`;
    case 'verified':
      return `badges.${namespace}.verifiedLabel`;
    case 'declared':
      return `badges.${namespace}.declaredLabel`;
    case 'stale':
      return `badges.${namespace}.staleLabel`;
  }
}

function badgeVisual(
  result: OnboardingBadgeResult | null,
  isChecking: boolean
): BadgeVisual | null {
  if (result === null) return isChecking ? 'loading' : null;
  const visual =
    result.provider === 'bluesky'
      ? atprotoBadgeViewModel(result.result, isChecking).visual
      : nostrBadgeViewModel(result.result, isChecking).visual;
  return visual === 'hidden' ? null : visual;
}

function badgeVisualStyle(visual: Exclude<BadgeVisual, 'loading'>): {
  readonly icon: 'checkmark.seal.fill' | 'checkmark.seal' | 'exclamationmark.triangle';
  readonly color: string;
} {
  switch (visual) {
    case 'verified':
      return { icon: 'checkmark.seal.fill', color: Colors.terminalGreen };
    case 'declared':
      return { icon: 'checkmark.seal', color: Colors.warning };
    case 'stale':
      return { icon: 'exclamationmark.triangle', color: Colors.text3 };
  }
}
