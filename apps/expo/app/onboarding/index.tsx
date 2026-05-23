/**
 * Onboarding entry — drives the 7-step flow via the local reducer.
 * Per-step screens land in `./steps/<name>.tsx` (Phase 5c).
 *
 * Renders a minimal skeleton today: title + Continue button. Replace each
 * step's body with the full ported SwiftUI screen as it's implemented.
 */
import { useReducer } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import { ThemedButton, ThemedText } from '@/components/themed';
import {
  initialOnboardingState,
  onboardingReducer,
  type OnboardingStep,
} from '@/onboarding/state';

const STEP_TITLES: Readonly<Record<OnboardingStep, string>> = {
  terminalWelcome: 'Welcome to Solidarity',
  profileSetup: 'Set up your profile',
  avatarSelection: 'Pick your avatar',
  permissions: 'Grant permissions',
  backupChoice: 'Choose backup',
  faceIdOptIn: 'Enable Face ID',
  done: 'Ready',
};

export default function OnboardingFlow() {
  const [state, dispatch] = useReducer(onboardingReducer, initialOnboardingState);

  const onContinue = () => {
    if (state.step === 'done') {
      router.replace('/(tabs)/people');
      return;
    }
    dispatch({ type: 'next' });
  };

  return (
    <View className="flex-1 bg-pageBg p-6 justify-between">
      <View>
        <ThemedText variant="headlineLarge">{STEP_TITLES[state.step]}</ThemedText>
        <ThemedText variant="bodyMedium" tone="secondary" className="mt-2">
          Step {String([...Object.keys(STEP_TITLES)].indexOf(state.step) + 1)} of 7
        </ThemedText>
      </View>
      <View>
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
              onPress={() => dispatch({ type: 'back' })}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}
