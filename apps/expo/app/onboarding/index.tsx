/**
 * Onboarding entry — 1.3.3 Task A2.5 converged the 7-step Swift-parity flow
 * onto the Verified Page story (US-01).
 *
 * Drives the flow via the local reducer + per-step component bodies under
 * src/onboarding/steps/. Each step has its own header chrome (back-chevron,
 * title, subtitle, CTA) — matching Swift's per-step `+Steps` extensions —
 * there is NO shared "Step N of M" wrapper in the design.
 *
 * Step order (src/onboarding/state.ts's `ONBOARDING_STEPS`):
 *   welcome → secureKeys → backup → page → connect → share → complete
 *
 * Dropped from the default sequence (see state.ts's module doc for the
 * full rationale + replay implications): profileSetup, avatarSetup,
 * importContacts, scanPassport. Those features (BusinessCard creation,
 * contacts import, passport scan) remain reachable from their normal
 * surfaces (cards/edit, People tab, Settings/Me) — only the onboarding
 * steps were removed.
 *
 * Side effects on `Start Using Solidarity`:
 *   1. Persist hasCompletedOnboarding = true (Swift AppStorage).
 *   2. Navigate to /(tabs)/people (MainTabView).
 *
 * (The old step 2/3 side effects — creating an initial BusinessCard from a
 * username + persisting a selected avatar — no longer apply: onboarding
 * doesn't collect either anymore. `selectedAnimal` stays reachable from
 * Settings › Appearance; a BusinessCard is still creatable from
 * /cards/edit.)
 */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { safeBack } from '@/navigation/safeBack';
import { useCallback, useReducer } from 'react';
import { View } from 'react-native';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';
import { BackupStep } from '@/onboarding/steps/BackupStep';
import { CompleteStep } from '@/onboarding/steps/CompleteStep';
import { ConnectStep } from '@/onboarding/steps/ConnectStep';
import { PageStep } from '@/onboarding/steps/PageStep';
import { SecureKeysStep } from '@/onboarding/steps/SecureKeysStep';
import { ShareStep } from '@/onboarding/steps/ShareStep';
import { TerminalWelcomeStep } from '@/onboarding/steps/TerminalWelcomeStep';
import { initialOnboardingState, onboardingReducer, type OnboardingStep } from '@/onboarding/state';
import { usePreferences } from '@/settings/preferences';
import { useTranslation } from '@/i18n';

export default function OnboardingFlow() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ replay?: string }>();
  const isReplay = params.replay === '1';
  const [state, dispatch] = useReducer(onboardingReducer, initialOnboardingState);
  const setPref = usePreferences((s) => s.set);

  const goTo = useCallback((step: OnboardingStep) => {
    dispatch({ type: 'goTo', step });
  }, []);

  const next = useCallback(() => {
    dispatch({ type: 'next' });
  }, []);

  const handleFinish = () => {
    setPref('hasCompletedOnboarding', true);
    router.replace('/(tabs)/people');
  };

  let body: React.ReactNode = null;
  switch (state.step) {
    case 'welcome':
      body = <TerminalWelcomeStep onBegin={next} />;
      break;
    case 'secureKeys':
      body = (
        <SecureKeysStep
          onBack={() => {
            goTo('welcome');
          }}
          onKeysGenerated={() => {
            dispatch({ type: 'setKeysGenerated', value: true });
            next();
          }}
        />
      );
      break;
    case 'backup':
      body = (
        <BackupStep
          onBack={() => {
            goTo('secureKeys');
          }}
          onDone={next}
        />
      );
      break;
    case 'page':
      body = (
        <PageStep
          onBack={() => {
            goTo('backup');
          }}
          onNext={next}
        />
      );
      break;
    case 'connect':
      body = (
        <ConnectStep
          preferredProvider={state.badgeProvider}
          warmResult={state.badgeResult}
          onSelectProvider={(provider) => {
            dispatch({ type: 'setBadgeProvider', value: provider });
          }}
          onBadgeResult={(result) => {
            dispatch({ type: 'setBadgeResult', value: result });
          }}
          onBack={() => {
            goTo('page');
          }}
          onNext={next}
        />
      );
      break;
    case 'share':
      body = (
        <ShareStep
          onBack={() => {
            goTo('connect');
          }}
          onNext={next}
        />
      );
      break;
    case 'complete':
      body = (
        <CompleteStep
          keysGenerated={state.keysGenerated}
          badgeProvider={state.badgeProvider}
          badgeResult={state.badgeResult}
          onBadgeResult={(result) => {
            dispatch({ type: 'setBadgeResult', value: result });
          }}
          onFinish={handleFinish}
        />
      );
      break;
  }

  if (!isReplay) return body;

  // Replay mode — mirrors Swift OnboardingReplayView: presents the flow as
  // a fullScreenCover with a top-trailing X button (54pt top, 20pt
  // trailing, searchBg fill, divider 1pt border).
  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ presentation: 'fullScreenModal' }} />
      {body}
      <View pointerEvents="box-none" style={{ position: 'absolute', top: 54, right: 20 }}>
        <PressableScale
          scaleTo={1}
          onPress={() => {
            safeBack();
          }}
          accessibilityRole="button"
          accessibilityLabel={t('onboardingFlow.close')}
          hitSlop={8}
          style={{
            padding: 10,
            backgroundColor: Colors.searchBg,
            borderWidth: 1,
            borderColor: Colors.divider,
          }}>
          <SfIcon name="xmark" size={14} weight="bold" color={Colors.text2} />
        </PressableScale>
      </View>
    </View>
  );
}
