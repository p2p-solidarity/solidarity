/**
 * Onboarding entry — 1:1 port of Swift OnboardingFlowView.swift.
 *
 * Drives the 7-step flow via the local reducer + per-step component bodies
 * under src/onboarding/steps/. Each step has its own header chrome
 * (back-chevron, title, subtitle, CTA), matching Swift's per-step `+Steps`
 * extensions — there is NO shared "Step N of M" wrapper in the iOS design.
 *
 * Step order (Swift OnboardingFlowView.Step):
 *   welcome → profileSetup → avatarSetup → secureKeys → importContacts
 *           → scanPassport → complete
 *
 * Side effects on `Start Using Solidarity`:
 *   1. Persist hasCompletedOnboarding = true (Swift AppStorage).
 *   2. Persist selectedAnimal (Swift theme_selected_animal).
 *   3. Create the initial BusinessCard (CardManager.createCard).
 *   4. Navigate to /(tabs)/people (MainTabView).
 */
import { router } from 'expo-router';
import { useCallback, useReducer } from 'react';

import { useCardStore } from '@/cards/cardManager';
import { AvatarSelectionGridStep } from '@/onboarding/steps/AvatarSelectionGridStep';
import { CompleteStep } from '@/onboarding/steps/CompleteStep';
import { DarkProfileSetupStep } from '@/onboarding/steps/DarkProfileSetupStep';
import { ImportContactsStep } from '@/onboarding/steps/ImportContactsStep';
import { ScanPassportStep } from '@/onboarding/steps/ScanPassportStep';
import { SecureKeysStep } from '@/onboarding/steps/SecureKeysStep';
import { TerminalWelcomeStep } from '@/onboarding/steps/TerminalWelcomeStep';
import {
  initialOnboardingState,
  onboardingReducer,
  type OnboardingProfile,
  type OnboardingStep,
} from '@/onboarding/state';
import { usePreferences } from '@/settings/preferences';
import { pushToast } from '@/feedback/toast';
import type { BusinessCard, SocialNetwork } from '@solidarity/shared';

export default function OnboardingFlow() {
  const [state, dispatch] = useReducer(onboardingReducer, initialOnboardingState);
  const setPref = usePreferences((s) => s.set);
  const upsertCard = useCardStore((s) => s.upsert);

  const goTo = useCallback((step: OnboardingStep) => {
    dispatch({ type: 'goTo', step });
  }, []);

  const next = useCallback(() => { dispatch({ type: 'next' }); }, []);

  const handleProfileChange = useCallback(
    (field: keyof OnboardingProfile, value: string) => {
      dispatch({ type: 'setProfileField', field, value });
    },
    []
  );

  const handleFinish = async () => {
    setPref('hasCompletedOnboarding', true);
    if (state.animal) setPref('selectedAnimal', state.animal);
    const trimmed = state.profile.username.trim();
    if (trimmed.length > 0) {
      const card = composeInitialCard(state.profile, state.animal ?? undefined);
      const result = await upsertCard(card);
      if (!result.ok) {
        pushToast(`Could not save card: ${result.error.message}`, 'warning');
      }
    }
    router.replace('/(tabs)/people');
  };

  switch (state.step) {
    case 'welcome':
      return <TerminalWelcomeStep onBegin={next} />;
    case 'profileSetup':
      return (
        <DarkProfileSetupStep
          profile={state.profile}
          onChange={handleProfileChange}
          onNext={next}
        />
      );
    case 'avatarSetup':
      return (
        <AvatarSelectionGridStep
          selection={state.animal}
          onSelect={(animal) => { dispatch({ type: 'setAnimal', animal }); }}
          onBack={() => { goTo('profileSetup'); }}
          onNext={next}
        />
      );
    case 'secureKeys':
      return (
        <SecureKeysStep
          onBack={() => { goTo('avatarSetup'); }}
          onKeysGenerated={() => {
            dispatch({ type: 'setKeysGenerated', value: true });
            next();
          }}
        />
      );
    case 'importContacts':
      return (
        <ImportContactsStep
          importedCount={state.importedCount}
          onBack={() => { goTo('secureKeys'); }}
          onAdvance={next}
          onImported={(count) => { dispatch({ type: 'addImportedCount', count }); }}
        />
      );
    case 'scanPassport':
      return (
        <ScanPassportStep
          passportScanned={state.passportScanned}
          onBack={() => { goTo('importContacts'); }}
          onAdvance={next}
        />
      );
    case 'complete':
      return (
        <CompleteStep
          username={state.profile.username}
          keysGenerated={state.keysGenerated}
          importedCount={state.importedCount}
          passportScanned={state.passportScanned}
          onFinish={() => { void handleFinish(); }}
        />
      );
  }
}

function composeInitialCard(profile: OnboardingProfile, animal: BusinessCard['animal']): BusinessCard {
  const now = new Date();
  const socials: SocialNetwork[] = [];
  const x = profile.xTwitter.trim();
  if (x.length > 0) {
    socials.push({ id: crypto.randomUUID(), platform: 'Twitter', username: x, url: undefined });
  }
  const li = profile.linkedIn.trim();
  if (li.length > 0) {
    socials.push({ id: crypto.randomUUID(), platform: 'LinkedIn', username: li, url: undefined });
  }
  return {
    id: crypto.randomUUID(),
    name: profile.username.trim(),
    title: undefined,
    company: undefined,
    email: undefined,
    phone: undefined,
    profileImage: undefined,
    socialNetworks: socials,
    skills: [],
    categories: [],
    sharingPreferences: {
      publicFields: new Set(['name']),
      professionalFields: new Set(['name', 'title', 'company', 'email']),
      personalFields: new Set(['name', 'email', 'phone']),
      allowForwarding: true,
      useZK: false,
      sharingFormat: 'didSigned',
    },
    verifiedFields: undefined,
    nameType: 'display_name',
    animal: animal ?? undefined,
    createdAt: now,
    updatedAt: now,
  };
}
