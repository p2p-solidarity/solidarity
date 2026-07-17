import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { BindingBadgeChip } from '@/components/badges/BindingBadgeChip';
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

  const openPublish = () => {
    onSelectProvider('nostr');
    router.push('/verify/nostr');
  };
  const hasPage = profileStatus === 'ready' && record !== null;

  return (
    <OnboardingScaffold
      onBack={onBack}
      title={t('connectStep.title')}
      subtitle={t('connectStep.subtitle')}
      footer={
        hasClaim || !hasPage ? (
          <ThemedButton
            label={t('onboarding.continue')}
            variant={hasClaim ? 'inverted' : 'secondary'}
            fullWidth
            onPress={onNext}
          />
        ) : (
          <View style={{ gap: 10 }}>
            <ThemedButton
              label={t('connectStep.continuePrivate')}
              variant="inverted"
              fullWidth
              onPress={onNext}
            />
            <ThemedButton
              label={t('connectStep.publishPage')}
              variant="secondary"
              fullWidth
              onPress={openPublish}
            />
            <ThemedText variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
              {t('connectStep.publishOptionalHint')}
            </ThemedText>
          </View>
        )
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
          <ThemedSurface variant="inset" className="rounded-none p-4">
            <View style={{ gap: 10 }}>
              <SfIcon name="checkmark.seal" size={22} color={Colors.primaryBlue} />
              <ThemedText variant="titleMedium">{t('connectStep.publishTitle')}</ThemedText>
              <ThemedText variant="bodySmall" tone="secondary">
                {t('connectStep.publishMessage')}
              </ThemedText>
            </View>
          </ThemedSurface>
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
