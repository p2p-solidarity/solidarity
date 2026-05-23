/**
 * Onboarding entry — drives the 7-step flow via the local reducer + the
 * per-step component bodies under src/onboarding/steps/.
 */
import { useReducer } from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';

import { ThemedButton, ThemedText } from '@/components/themed';
import {
  initialOnboardingState,
  onboardingReducer,
  ONBOARDING_STEPS,
  type OnboardingStep,
} from '@/onboarding/state';
import { AvatarStep } from '@/onboarding/steps/AvatarStep';
import { ProfileStep } from '@/onboarding/steps/ProfileStep';
import { TerminalWelcomeStep } from '@/onboarding/steps/TerminalWelcomeStep';
import { usePreferences } from '@/settings/preferences';

const STEP_TITLES: Readonly<Record<OnboardingStep, string>> = {
  terminalWelcome: 'Welcome',
  profileSetup: 'Profile',
  avatarSelection: 'Avatar',
  permissions: 'Permissions',
  backupChoice: 'Backup',
  faceIdOptIn: 'Face ID',
  done: 'Ready',
};

export default function OnboardingFlow() {
  const [state, dispatch] = useReducer(onboardingReducer, initialOnboardingState);
  const setPref = usePreferences((s) => s.set);

  const onContinue = () => {
    if (state.step === 'done') {
      setPref('hasCompletedOnboarding', true);
      router.replace('/(tabs)/people');
      return;
    }
    dispatch({ type: 'next' });
  };

  const stepIdx = ONBOARDING_STEPS.indexOf(state.step) + 1;

  return (
    <View className="flex-1 bg-pageBg">
      <ScrollView className="flex-1 px-6 pt-6" contentContainerClassName="pb-10">
        <ThemedText variant="bodySmall" tone="tertiary">
          Step {String(stepIdx)} of {String(ONBOARDING_STEPS.length)}
        </ThemedText>
        <ThemedText variant="headlineLarge" className="mt-1">
          {STEP_TITLES[state.step]}
        </ThemedText>

        <View className="mt-6">
          {state.step === 'terminalWelcome' ? <TerminalWelcomeStep /> : null}
          {state.step === 'profileSetup' ? (
            <ProfileStep
              name={state.profile.name}
              handle={state.profile.handle}
              onChange={(p) =>
                { dispatch({ type: 'setProfile', name: p.name, handle: p.handle }); }
              }
            />
          ) : null}
          {state.step === 'avatarSelection' ? (
            <AvatarStep
              value={state.animal}
              onSelect={(a) => { dispatch({ type: 'setAnimal', animal: a }); }}
            />
          ) : null}
        </View>
      </ScrollView>

      <View className="px-6 pb-10 pt-2">
        <ThemedButton
          label={state.step === 'done' ? 'Enter Solidarity' : 'Continue'}
          size="lg"
          fullWidth
          onPress={onContinue}
        />
        {state.step !== 'terminalWelcome' ? (
          <View className="mt-3">
            <ThemedButton
              variant="secondary"
              label="Back"
              fullWidth
              onPress={() => { dispatch({ type: 'back' }); }}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}
