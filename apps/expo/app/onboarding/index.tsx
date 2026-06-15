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
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useReducer } from 'react';
import { Pressable, View } from 'react-native';

import { useCardStore } from '@/cards/cardManager';
import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';
import { AvatarSelectionGridStep } from '@/onboarding/steps/AvatarSelectionGridStep';
import { CompleteStep } from '@/onboarding/steps/CompleteStep';
import { DarkProfileSetupStep } from '@/onboarding/steps/DarkProfileSetupStep';
import { ImportContactsStep } from '@/onboarding/steps/ImportContactsStep';
import { ScanPassportStep } from '@/onboarding/steps/ScanPassportStep';
import { SecureKeysStep } from '@/onboarding/steps/SecureKeysStep';
import { TerminalWelcomeStep } from '@/onboarding/steps/TerminalWelcomeStep';
import { subscribePassportOnboardingCompleted } from '@/onboarding/passportHandoff';
import {
  initialOnboardingState,
  onboardingReducer,
  type OnboardingProfile,
  type OnboardingStep,
} from '@/onboarding/state';
import { usePreferences } from '@/settings/preferences';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { uuid, type BusinessCard, type SocialNetwork } from '@solidarity/shared';

export default function OnboardingFlow() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ replay?: string }>();
  const isReplay = params.replay === '1';
  const [state, dispatch] = useReducer(onboardingReducer, initialOnboardingState);
  const setPref = usePreferences((s) => s.set);
  const upsertCard = useCardStore((s) => s.upsert);

  const goTo = useCallback((step: OnboardingStep) => {
    dispatch({ type: 'goTo', step });
  }, []);

  const next = useCallback(() => {
    dispatch({ type: 'next' });
  }, []);

  // Faithful port of Swift's `PassportOnboardingFlowView(onCompleted:)` closure
  // (OnboardingFlowView.swift): when the shared /passport route finishes a
  // persist launched from onboarding, mark the passport scanned and advance to
  // the `complete` step. Without this the wizard returned to the scanPassport
  // step with passportScanned stuck false (so "Skip" stayed and Complete showed
  // "Skipped" despite a successful scan).
  useEffect(
    () =>
      subscribePassportOnboardingCompleted(() => {
        dispatch({ type: 'setPassportScanned', value: true });
        dispatch({ type: 'goTo', step: 'complete' });
      }),
    []
  );

  const handleProfileChange = useCallback((field: keyof OnboardingProfile, value: string) => {
    dispatch({ type: 'setProfileField', field, value });
  }, []);

  const handleFinish = async () => {
    setPref('hasCompletedOnboarding', true);
    if (state.animal) setPref('selectedAnimal', state.animal);
    const trimmed = state.profile.username.trim();
    if (trimmed.length > 0) {
      const card = composeInitialCard(state.profile, state.animal ?? undefined);
      const result = await upsertCard(card);
      if (!result.ok) {
        pushToast(`${t('onboardingFlow.saveCardFailed')}: ${result.error.message}`, 'warning');
      }
    }
    router.replace('/(tabs)/people');
  };

  let body: React.ReactNode = null;
  switch (state.step) {
    case 'welcome':
      body = <TerminalWelcomeStep onBegin={next} />;
      break;
    case 'profileSetup':
      body = (
        <DarkProfileSetupStep
          profile={state.profile}
          onChange={handleProfileChange}
          onNext={next}
        />
      );
      break;
    case 'avatarSetup':
      body = (
        <AvatarSelectionGridStep
          selection={state.animal}
          onSelect={(animal) => {
            dispatch({ type: 'setAnimal', animal });
          }}
          onBack={() => {
            goTo('profileSetup');
          }}
          onNext={next}
        />
      );
      break;
    case 'secureKeys':
      body = (
        <SecureKeysStep
          onBack={() => {
            goTo('avatarSetup');
          }}
          onKeysGenerated={() => {
            dispatch({ type: 'setKeysGenerated', value: true });
            next();
          }}
        />
      );
      break;
    case 'importContacts':
      body = (
        <ImportContactsStep
          importedCount={state.importedCount}
          onBack={() => {
            goTo('secureKeys');
          }}
          onAdvance={next}
          onImported={(count) => {
            dispatch({ type: 'setImportedCount', count });
          }}
        />
      );
      break;
    case 'scanPassport':
      body = (
        <ScanPassportStep
          passportScanned={state.passportScanned}
          onBack={() => {
            goTo('importContacts');
          }}
          onAdvance={next}
        />
      );
      break;
    case 'complete':
      body = (
        <CompleteStep
          username={state.profile.username}
          keysGenerated={state.keysGenerated}
          importedCount={state.importedCount}
          passportScanned={state.passportScanned}
          onFinish={() => {
            void handleFinish();
          }}
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
        <Pressable
          onPress={() => {
            router.back();
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
        </Pressable>
      </View>
    </View>
  );
}

function composeInitialCard(
  profile: OnboardingProfile,
  animal: BusinessCard['animal']
): BusinessCard {
  const now = new Date();
  const socials: SocialNetwork[] = [];
  const x = profile.xTwitter.trim();
  if (x.length > 0) {
    socials.push({ id: uuid(), platform: 'Twitter', username: x, url: undefined });
  }
  const li = profile.linkedIn.trim();
  if (li.length > 0) {
    socials.push({ id: uuid(), platform: 'LinkedIn', username: li, url: undefined });
  }
  return {
    id: uuid(),
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
      // ZK on by default for the user's own identity card — never share raw.
      useZK: true,
      sharingFormat: 'zkProof',
    },
    verifiedFields: undefined,
    nameType: 'display_name',
    animal: animal ?? undefined,
    createdAt: now,
    updatedAt: now,
  };
}
