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
import { ScrollView, TextInput, View, type KeyboardTypeOptions } from 'react-native';

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
    <ScrollView
      className="bg-pageBg flex-1"
      contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 40, paddingBottom: 32 }}
      keyboardShouldPersistTaps="handled"
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
        />

        <DarkInputField
          title="Link"
          placeholder="https://yoursite.com"
          value={profile.link}
          onChangeText={(v) => { onChange('link', v); }}
          keyboardType="url"
          autoCapitalize="none"
        />

        <DarkInputField
          title="X(twitter)"
          placeholder="https://x.com/username"
          value={profile.xTwitter}
          onChangeText={(v) => { onChange('xTwitter', v); }}
          autoCapitalize="none"
        />

        <DarkInputField
          title="LinkedIn"
          placeholder="linkedin/links/here"
          value={profile.linkedIn}
          onChangeText={(v) => { onChange('linkedIn', v); }}
          autoCapitalize="none"
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
