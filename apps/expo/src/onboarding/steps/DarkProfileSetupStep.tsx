/**
 * DarkProfileSetupStep — 1:1 port of Swift DarkProfileSetupForm.swift.
 *
 * Fields (Swift verbatim, top → bottom):
 *   1. username (required, "Choose your username", placeholder "Enter your username")
 *   2. link     ("Link", placeholder "https://yoursite.com", URL keyboard)
 *   3. xTwitter ("X(twitter)", placeholder "https://x.com/username")
 *   4. linkedIn ("LinkedIn", placeholder "linkedin/links/here")
 *   5. wallet   ("Link to your ERC20 wallet (?)", placeholder "0x...",
 *                preceded by an "Export" section heading + caption)
 *
 * Validates username on Next-tap; haptic.error on empty, haptic.success on valid.
 */
import { useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput,
  TouchableWithoutFeedback,
  View,
  type KeyboardTypeOptions,
  type ReturnKeyTypeOptions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedButton, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';
import type { OnboardingProfile } from '@/onboarding/state';

export interface DarkProfileSetupStepProps {
  readonly profile: OnboardingProfile;
  readonly onChange: (field: keyof OnboardingProfile, value: string) => void;
  readonly onNext: () => void;
}

export function DarkProfileSetupStep({ profile, onChange, onNext }: DarkProfileSetupStepProps) {
  const insets = useSafeAreaInsets();
  const [hasAttemptedNext, setHasAttemptedNext] = useState(false);
  const usernameError =
    hasAttemptedNext && profile.username.trim().length === 0 ? 'Username is required' : null;

  const handleNext = () => {
    setHasAttemptedNext(true);
    if (profile.username.trim().length === 0) {
      haptic('error');
      return;
    }
    haptic('success');
    onNext();
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="bg-pageBg flex-1"
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            paddingHorizontal: 24,
            paddingTop: insets.top + 16,
            paddingBottom: insets.bottom + 80,
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
        >
          <View className="items-center" style={{ gap: 8, paddingBottom: 24 }}>
            <ThemedText variant="headlineMedium">Hi,</ThemedText>
            <ThemedText variant="bodySmall" tone="secondary" style={{ textAlign: 'center' }}>
              {"It's good to have you here <3\nLet's set up your profile"}
            </ThemedText>
          </View>

          <View style={{ gap: 24 }}>
            <DarkInputField
              title="Choose your username"
              placeholder="Enter your username"
              value={profile.username}
              onChangeText={(v) => { onChange('username', v); }}
              isRequired
              errorMessage={usernameError}
              returnKeyType="next"
            />

            <DarkInputField
              title="Link"
              placeholder="https://yoursite.com"
              value={profile.link}
              onChangeText={(v) => { onChange('link', v); }}
              keyboardType="url"
              autoCapitalize="none"
              returnKeyType="next"
            />

            <DarkInputField
              title="X(twitter)"
              placeholder="https://x.com/username"
              value={profile.xTwitter}
              onChangeText={(v) => { onChange('xTwitter', v); }}
              autoCapitalize="none"
              returnKeyType="next"
            />

            <DarkInputField
              title="LinkedIn"
              placeholder="linkedin/links/here"
              value={profile.linkedIn}
              onChangeText={(v) => { onChange('linkedIn', v); }}
              autoCapitalize="none"
              returnKeyType="next"
            />

            <View style={{ gap: 4 }}>
              <ThemedText variant="label">Export</ThemedText>
              <ThemedText variant="caption" tone="tertiary">
                You can do this later or whenever you&apos;re ready to export your data.
              </ThemedText>
            </View>

            <DarkInputField
              title="Link to your ERC20 wallet (?)"
              placeholder="0x..."
              value={profile.wallet}
              onChangeText={(v) => { onChange('wallet', v); }}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={Keyboard.dismiss}
            />

            <View style={{ paddingTop: 16 }}>
              <ThemedButton
                label="Next"
                variant="inverted"
                fullWidth
                haptic={false}
                onPress={handleNext}
              />
            </View>
          </View>
        </ScrollView>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

interface DarkInputFieldProps {
  readonly title: string;
  readonly placeholder: string;
  readonly value: string;
  readonly onChangeText: (v: string) => void;
  readonly isRequired?: boolean;
  readonly errorMessage?: string | null;
  readonly keyboardType?: KeyboardTypeOptions;
  readonly autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  readonly autoCorrect?: boolean;
  readonly returnKeyType?: ReturnKeyTypeOptions;
  readonly onSubmitEditing?: () => void;
}

function DarkInputField({
  title,
  placeholder,
  value,
  onChangeText,
  isRequired = false,
  errorMessage = null,
  keyboardType = 'default',
  autoCapitalize = 'sentences',
  autoCorrect = true,
  returnKeyType,
  onSubmitEditing,
}: DarkInputFieldProps) {
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        <ThemedText variant="label">{title}</ThemedText>
        {isRequired ? <ThemedText variant="label" tone="error">*</ThemedText> : null}
      </View>

      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.text3}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        submitBehavior={returnKeyType === 'done' ? 'blurAndSubmit' : 'submit'}
        className="bg-searchBg text-text1"
        style={{
          paddingHorizontal: 14,
          paddingVertical: 14,
          fontSize: 15,
          borderWidth: 1,
          borderColor: errorMessage ? Colors.destructive : Colors.divider,
        }}
      />

      {errorMessage ? (
        <ThemedText variant="caption" tone="error">{errorMessage}</ThemedText>
      ) : null}
    </View>
  );
}
