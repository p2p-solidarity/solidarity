/**
 * CompleteStep — 1.3.3 Task A2.5 converged-flow summary. Was previously a
 * 1:1 port of Swift's `finalCompletionStep` (Profile/Key Pair/Contacts/
 * Passport rows, all hardcoded English); onboarding no longer collects a
 * legacy username or imports contacts/scans a passport by default (those
 * steps were dropped — see `src/onboarding/state.ts`'s module doc), so the
 * summary now reflects what this flow actually does: Key Pair → Backup →
 * Page → First badge. Badge truth always comes from the shared verifier;
 * the reducer only retains a real warm result between steps.
 *
 *   [ SYSTEM READY ]
 *
 *   ┌────────────────────────────┐
 *   │ ✓ Key Pair                 │
 *   │   Generated                │
 *   │ ✓ Backup                   │
 *   │   iCloud Keychain          │
 *   │ ✓ Page                     │
 *   │   Ada Lovelace             │
 *   │ ✓ First badge              │
 *   │   Bluesky · Verified       │
 *   └────────────────────────────┘
 *
 *   [ Start Using Solidarity ]   (inverted CTA)
 *
 * The sole celebratory motion is earned only by an exactly `verified`
 * result: one 300 ms ease-out scale from 0.95 to 1 on the real badge chip.
 */
import { useEffect } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BindingBadgeChip } from '@/components/badges/BindingBadgeChip';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';
import { useTranslation } from '@/i18n';
import type {
  OnboardingBadgeProvider,
  OnboardingBadgeResult,
} from '@/onboarding/badgeVerification';
import {
  useOnboardingBadgeVerification,
  type OnboardingBadgeCheckState,
} from '@/onboarding/useOnboardingBadgeVerification';
import { useProfileStore } from '@/profile/store';
import { usePreferences } from '@/settings/preferences';

export interface CompleteStepProps {
  readonly keysGenerated: boolean;
  readonly badgeProvider: OnboardingBadgeProvider | null;
  readonly badgeResult: OnboardingBadgeResult | null;
  readonly onBadgeResult: (result: OnboardingBadgeResult | null) => void;
  readonly onFinish: () => void;
}

export function CompleteStep({
  keysGenerated,
  badgeProvider,
  badgeResult,
  onBadgeResult,
  onFinish,
}: CompleteStepProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const rootKeySyncChoice = usePreferences((s) => s.rootKeySyncChoice);
  const profileStatus = useProfileStore((s) => s.status);
  const record = useProfileStore((s) => s.record);
  const badge = useOnboardingBadgeVerification(record, badgeProvider, badgeResult, onBadgeResult);

  const handleFinish = () => {
    haptic('success');
    onFinish();
  };

  const backupDone = rootKeySyncChoice !== 'undecided';
  const backupDetail =
    rootKeySyncChoice === 'icloud'
      ? t('completeStep.backupIcloud')
      : rootKeySyncChoice === 'mnemonicOnly'
        ? t('completeStep.backupMnemonic')
        : t('completeStep.backupNotSet');

  const pageDone =
    profileStatus === 'ready' &&
    record?.alsoKnownAs.some((alias) => alias.startsWith('nostr:npub')) === true;
  const displayName = record?.displayName.trim() ?? '';
  const pageDetail = pageDone
    ? displayName.length > 0
      ? displayName
      : t('completeStep.pageCreated')
    : t('completeStep.pageSkipped');

  return (
    <View
      className="flex-1 bg-pageBg"
      style={{
        paddingHorizontal: 24,
        paddingTop: insets.top + 56,
        paddingBottom: insets.bottom + 24,
        gap: 24,
      }}>
      <View style={{ flex: 1 }} />

      <View style={{ alignItems: 'center' }}>
        <ThemedText
          variant="headlineLarge"
          style={{
            color: Colors.terminalGreen,
            fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
            ...(Platform.OS === 'ios'
              ? { textShadowColor: `${Colors.terminalGreen}80`, textShadowRadius: 10 }
              : {}),
          }}>
          {t('completeStep.systemReady')}
        </ThemedText>
      </View>

      <View
        style={{
          padding: 16,
          backgroundColor: Colors.searchBg,
          borderWidth: 1,
          borderColor: Colors.divider,
          gap: 12,
        }}>
        <CompletionRow
          title={t('completeStep.keyPair')}
          done={keysGenerated}
          detail={keysGenerated ? t('completeStep.keyGenerated') : t('completeStep.keyNotCreated')}
        />
        <CompletionRow title={t('completeStep.backup')} done={backupDone} detail={backupDetail} />
        <CompletionRow title={t('completeStep.page')} done={pageDone} detail={pageDetail} />
        <FirstBadgeRow badge={badge} providerHint={badgeProvider} />
      </View>

      <View style={{ flex: 1 }} />

      <ThemedButton
        label={t('completeStep.start')}
        variant="inverted"
        fullWidth
        haptic={false}
        onPress={handleFinish}
      />
    </View>
  );
}

function FirstBadgeRow({
  badge,
  providerHint,
}: {
  readonly badge: OnboardingBadgeCheckState;
  readonly providerHint: OnboardingBadgeProvider | null;
}) {
  const { t } = useTranslation();
  const verified = badge.result?.result.state === 'verified';
  const reduceMotion = useReducedMotion();
  const shouldCelebrate = verified && !reduceMotion;
  const scale = useSharedValue(shouldCelebrate ? 0.95 : 1);

  useEffect(() => {
    if (!shouldCelebrate) {
      scale.value = 1;
      return;
    }
    scale.value = 0.95;
    scale.value = withTiming(1, {
      duration: 300,
      easing: Easing.out(Easing.cubic),
    });
  }, [scale, shouldCelebrate]);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const coldChecking = badge.status === 'checking' && badge.result === null;
  const coldError = badge.status === 'error' && badge.result === null;
  const badgeVisual = firstBadgeVisual(badge);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
      <View style={{ width: 18, height: 22, alignItems: 'center', justifyContent: 'center' }}>
        {coldChecking ? (
          <ActivityIndicator size="small" color={Colors.text3} />
        ) : (
          <SfIcon name={badgeVisual.icon} size={18} color={badgeVisual.color} />
        )}
      </View>
      <View style={{ flex: 1, gap: 6 }}>
        <ThemedText
          variant="bodySmall"
          style={{ fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontWeight: '600' }}>
          {t('completeStep.firstBadge')}
        </ThemedText>

        {badge.result !== null ? (
          <>
            <Animated.View
              style={[
                animatedStyle,
                verified
                  ? {
                      alignSelf: 'flex-start',
                      shadowColor: Colors.terminalGreen,
                      shadowOpacity: 0.28,
                      shadowRadius: 10,
                      shadowOffset: { width: 0, height: 0 },
                      elevation: 3,
                    }
                  : undefined,
              ]}>
              <BindingBadgeChip
                result={badge.result}
                isChecking={badge.status === 'checking'}
                providerHint={providerHint}
                animateStateChange={false}
              />
            </Animated.View>
            {badge.status === 'error' ? (
              <ThemedText variant="caption" tone="tertiary">
                {t('completeStep.badgeRefreshFailed')}
              </ThemedText>
            ) : null}
          </>
        ) : (
          <ThemedText variant="caption" tone={coldError ? 'error' : 'secondary'}>
            {coldChecking
              ? t('completeStep.badgeChecking')
              : coldError
                ? t('completeStep.badgeCheckFailed')
                : t('completeStep.badgeSkipped')}
          </ThemedText>
        )}
      </View>
    </View>
  );
}

function firstBadgeVisual(badge: OnboardingBadgeCheckState): {
  readonly icon: 'checkmark.seal.fill' | 'checkmark.seal' | 'exclamationmark.triangle' | 'circle';
  readonly color: string;
} {
  if (badge.result === null) {
    return badge.status === 'error'
      ? { icon: 'exclamationmark.triangle', color: Colors.destructive }
      : { icon: 'circle', color: Colors.text3 };
  }
  switch (badge.result.result.state) {
    case 'verified':
      return { icon: 'checkmark.seal.fill', color: Colors.terminalGreen };
    case 'stale':
      return { icon: 'exclamationmark.triangle', color: Colors.text3 };
    case 'declared':
    case 'revoked':
      return { icon: 'checkmark.seal', color: Colors.warning };
  }
}

function CompletionRow({ title, done, detail }: { title: string; done: boolean; detail: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <SfIcon
        name={done ? 'checkmark.circle.fill' : 'circle'}
        size={18}
        color={done ? Colors.terminalGreen : Colors.text3}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <ThemedText
          variant="bodySmall"
          style={{ fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontWeight: '600' }}>
          {title}
        </ThemedText>
        <ThemedText variant="caption" tone="secondary">
          {detail}
        </ThemedText>
      </View>
    </View>
  );
}
