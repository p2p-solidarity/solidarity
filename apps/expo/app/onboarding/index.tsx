import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useReducer, useState, type ReactNode } from 'react';
import { Modal, View } from 'react-native';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';
import { safeBack } from '@/navigation/safeBack';
import { PRIMARY_TAB_HREFS } from '@/navigation/primaryTabs';
import { ExistingAccountSheet } from '@/onboarding/steps/ExistingAccountSheet';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { LinksStep } from '@/onboarding/steps/LinksStep';
import { PasskeyStep } from '@/onboarding/steps/PasskeyStep';
import { ReadyStep } from '@/onboarding/steps/ReadyStep';
import { UsernameStep } from '@/onboarding/steps/UsernameStep';
import { WelcomeStep } from '@/onboarding/steps/WelcomeStep';
import {
  initialOnboardingState,
  onboardingReducer,
  type OnboardingStep,
} from '@/onboarding/state';
import { useProfileStore } from '@/profile/store';
import { usePreferences } from '@/settings/preferences';

export default function OnboardingFlow(): ReactNode {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ replay?: string }>();
  const isReplay = params.replay === '1';
  const [state, dispatch] = useReducer(onboardingReducer, initialOnboardingState);
  const [loginOpen, setLoginOpen] = useState(false);
  const [takenName, setTakenName] = useState<string | null>(null);
  const [onPickAnother, setOnPickAnother] = useState<(() => void) | null>(null);
  const setPref = usePreferences((preferences) => preferences.set);
  const username = usePreferences((preferences) => preferences.publicPageUsername);
  const profileStatus = useProfileStore((profile) => profile.status);

  const goTo = useCallback((step: OnboardingStep) => {
    dispatch({ type: 'goTo', step });
  }, []);
  const next = useCallback(() => {
    dispatch({ type: 'next' });
  }, []);

  const markComplete = (): void => {
    setPref('hasCompletedOnboarding', true);
  };

  const finishToPage = (): void => {
    markComplete();
    if (isReplay) safeBack();
    else router.replace(PRIMARY_TAB_HREFS.page);
  };

  const finishToFirstCheck = (): void => {
    markComplete();
    router.replace({
      pathname: PRIMARY_TAB_HREFS.page,
      params: { addProof: '1' },
    });
  };

  const recoveredExistingAccount = (): void => {
    setLoginOpen(false);
    if (username.length > 0 && profileStatus === 'ready') finishToPage();
    else goTo('username');
  };

  let body: ReactNode;
  switch (state.step) {
    case 'welcome':
      body = (
        <WelcomeStep
          onStart={next}
          onExistingAccount={() => { setLoginOpen(true); }}
        />
      );
      break;
    case 'username':
      body = (
        <UsernameStep
          onBack={() => { goTo('welcome'); }}
          onNext={next}
          onTaken={(name, pickAnother) => {
            setTakenName(name);
            setOnPickAnother(() => pickAnother);
          }}
        />
      );
      break;
    case 'passkey':
      body = (
        <PasskeyStep
          onBack={() => { goTo('username'); }}
          onCreated={() => {
            dispatch({ type: 'setKeysGenerated', value: true });
            next();
          }}
        />
      );
      break;
    case 'links':
      body = (
        <LinksStep
          onBack={() => { goTo('passkey'); }}
          onDone={next}
          onNameTaken={() => { goTo('username'); }}
        />
      );
      break;
    case 'complete':
      body = (
        <ReadyStep
          keysGenerated={state.keysGenerated}
          onBack={() => { goTo('links'); }}
          onFirstCheck={finishToFirstCheck}
          onBrowse={finishToPage}
        />
      );
      break;
  }

  return (
    <View style={{ flex: 1 }}>
      {isReplay ? <Stack.Screen options={{ presentation: 'fullScreenModal' }} /> : null}
      {body}
      <ExistingAccountSheet
        visible={loginOpen}
        onClose={() => { setLoginOpen(false); }}
        onRecovered={recoveredExistingAccount}
      />
      <Modal
        transparent
        animationType="slide"
        visible={takenName !== null}
        onRequestClose={() => { setTakenName(null); }}>
        <View className="flex-1 justify-end bg-overlayBg/40">
          <ThemedSurface
            variant="elevated"
            className="rounded-t-2xl px-6 pb-8 pt-3"
            style={{ gap: 16 }}>
            <View className="h-1 w-9 self-center rounded-full bg-divider" />
            <ThemedText variant="headlineMedium">
              @{takenName} {t('ob.handle.taken_title')}
            </ThemedText>
            <ThemedButton
              label={t('ob.handle.pick_another')}
              variant="primary"
              fullWidth
              onPress={() => { setTakenName(null); }}
            />
            <ThemedButton
              label={t('ob.handle.claim_later')}
              variant="secondary"
              fullWidth
              onPress={() => {
                setTakenName(null);
                onPickAnother?.();
              }}
            />
            <ThemedButton
              label={t('login.close')}
              variant="secondary"
              fullWidth
              onPress={() => { setTakenName(null); }}
            />
          </ThemedSurface>
        </View>
      </Modal>
      {isReplay ? (
        <View pointerEvents="box-none" style={{ position: 'absolute', top: 54, right: 20 }}>
          <PressableScale
            scaleTo={1}
            onPress={() => { safeBack(); }}
            accessibilityRole="button"
            accessibilityLabel={t('onboardingFlow.close')}
            hitSlop={8}
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
            <SfIcon name="xmark" size={14} weight="bold" color={Colors.text2} />
          </PressableScale>
        </View>
      ) : null}
    </View>
  );
}
