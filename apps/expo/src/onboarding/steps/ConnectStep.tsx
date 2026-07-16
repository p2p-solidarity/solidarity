import { router } from 'expo-router';
import type { SFSymbol } from 'expo-symbols';
import type { ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { BindingBadgeChip } from '@/components/badges/BindingBadgeChip';
import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';
import {
  claimedBadgeProviders,
  type OnboardingBadgeProvider,
  type OnboardingBadgeResult,
} from '@/onboarding/badgeVerification';
import {
  useOnboardingBadgeVerification,
  type OnboardingBadgeCheckState,
} from '@/onboarding/useOnboardingBadgeVerification';
import { useProfileStore } from '@/profile/store';

import { OnboardingScaffold } from './OnboardingScaffold';

export interface ConnectStepProps {
  readonly preferredProvider: OnboardingBadgeProvider | null;
  readonly warmResult: OnboardingBadgeResult | null;
  readonly onSelectProvider: (provider: OnboardingBadgeProvider) => void;
  readonly onBadgeResult: (result: OnboardingBadgeResult | null) => void;
  readonly onBack: () => void;
  readonly onNext: () => void;
}

export function ConnectStep({
  preferredProvider,
  warmResult,
  onSelectProvider,
  onBadgeResult,
  onBack,
  onNext,
}: ConnectStepProps): ReactNode {
  const { t } = useTranslation();
  const record = useProfileStore((state) => state.record);
  const profileStatus = useProfileStore((state) => state.status);
  const badge = useOnboardingBadgeVerification(
    record,
    preferredProvider,
    warmResult,
    onBadgeResult
  );
  const hasClaim = record !== null && claimedBadgeProviders(record).length > 0;

  const openProvider = (provider: OnboardingBadgeProvider) => {
    onSelectProvider(provider);
    if (provider === 'bluesky') {
      router.push('/verify/bluesky');
    } else {
      router.push('/verify/nostr');
    }
  };

  return (
    <OnboardingScaffold
      onBack={onBack}
      title={t('connectStep.title')}
      subtitle={t('connectStep.subtitle')}
      footer={
        <ThemedButton
          label={hasClaim ? t('onboarding.continue') : t('connectStep.skip')}
          variant={hasClaim ? 'inverted' : 'secondary'}
          fullWidth
          onPress={onNext}
        />
      }>
      <View style={{ flex: 1, justifyContent: 'center', gap: 16 }}>
        {profileStatus !== 'ready' || record === null ? (
          <ThemedSurface variant="outlined" className="rounded-none p-4">
            <View style={{ gap: 8 }}>
              <ThemedText variant="titleMedium">{t('connectStep.noPageTitle')}</ThemedText>
              <ThemedText variant="bodySmall" tone="secondary">
                {t('connectStep.noPageMessage')}
              </ThemedText>
            </View>
          </ThemedSurface>
        ) : hasClaim ? (
          <ExistingBindingState badge={badge} preferredProvider={preferredProvider} />
        ) : (
          <View style={{ gap: 12 }}>
            <ConnectOptionCard
              primary
              icon="checkmark.seal.fill"
              title={t('connectStep.blueskyTitle')}
              eyebrow={t('connectStep.recommended')}
              detail={t('connectStep.blueskyDetail')}
              onPress={() => {
                openProvider('bluesky');
              }}
            />
            <ConnectOptionCard
              icon="bolt.fill"
              title={t('connectStep.nostrTitle')}
              eyebrow={t('connectStep.noAccount')}
              detail={t('connectStep.nostrDetail')}
              onPress={() => {
                openProvider('nostr');
              }}
            />
          </View>
        )}
      </View>
    </OnboardingScaffold>
  );
}

function ExistingBindingState({
  badge,
  preferredProvider,
}: {
  readonly badge: OnboardingBadgeCheckState;
  readonly preferredProvider: OnboardingBadgeProvider | null;
}): ReactNode {
  const { t } = useTranslation();
  const renderableResult = badge.result;
  const checking = badge.status === 'checking' && renderableResult === null;

  return (
    <ThemedSurface variant="inset" className="rounded-none p-4">
      <View style={{ gap: 12 }}>
        <ThemedText variant="titleMedium">{t('connectStep.currentBadge')}</ThemedText>
        {checking ? (
          <View style={{ alignItems: 'center', gap: 10, paddingVertical: 16 }}>
            <ActivityIndicator size="small" color={Colors.text3} />
            <ThemedText variant="bodySmall" tone="secondary">
              {t('connectStep.checking')}
            </ThemedText>
          </View>
        ) : renderableResult !== null ? (
          <>
            <BindingBadgeChip
              result={renderableResult}
              isChecking={badge.status === 'checking'}
              providerHint={preferredProvider}
            />
            <ThemedText variant="bodySmall" tone="secondary">
              {t(
                renderableResult.result.state === 'verified'
                  ? 'connectStep.stateVerified'
                  : renderableResult.result.state === 'stale'
                    ? 'connectStep.stateStale'
                    : 'connectStep.stateDeclared'
              )}
            </ThemedText>
          </>
        ) : (
          <ThemedText variant="bodySmall" tone="secondary">
            {t('connectStep.checkError')}
          </ThemedText>
        )}
      </View>
    </ThemedSurface>
  );
}

function ConnectOptionCard({
  primary = false,
  icon,
  title,
  eyebrow,
  detail,
  onPress,
}: {
  readonly primary?: boolean;
  readonly icon: SFSymbol;
  readonly title: string;
  readonly eyebrow: string;
  readonly detail: string;
  readonly onPress: () => void;
}): ReactNode {
  return (
    <PressableScale
      haptic="tap"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}>
      <ThemedSurface
        variant="outlined"
        className="rounded-none p-4"
        style={{
          minHeight: 112,
          borderColor: primary ? Colors.primaryBlue : Colors.divider,
          backgroundColor: primary ? Colors.featuredCardBg : Colors.cardBg,
        }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          <View
            style={{
              width: 36,
              height: 36,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: primary ? Colors.primaryBlue : Colors.divider,
            }}>
            <SfIcon name={icon} size={17} color={primary ? Colors.primaryBlue : Colors.text2} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <ThemedText
              variant="label"
              style={{ color: primary ? Colors.primaryBlue : Colors.text2 }}>
              {eyebrow}
            </ThemedText>
            <ThemedText variant="titleMedium">{title}</ThemedText>
            <ThemedText variant="caption" tone="secondary">
              {detail}
            </ThemedText>
          </View>
          <SfIcon name="chevron.right" size={12} color={Colors.text3} />
        </View>
      </ThemedSurface>
    </PressableScale>
  );
}
