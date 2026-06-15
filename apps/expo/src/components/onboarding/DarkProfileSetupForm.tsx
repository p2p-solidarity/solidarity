import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';

import { ThemedButton, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';

export interface DarkProfileFormValues {
  readonly name: string;
  readonly title: string;
  readonly company: string;
}

export interface DarkProfileSetupFormProps {
  readonly values: DarkProfileFormValues;
  readonly onChange: (field: keyof DarkProfileFormValues, value: string) => void;
  readonly onSubmit: () => void;
  readonly submitLabel?: string;
}

export function DarkProfileSetupForm({
  values,
  onChange,
  onSubmit,
  submitLabel = 'Next',
}: DarkProfileSetupFormProps) {
  const [attempted, setAttempted] = useState(false);
  const nameError = attempted && values.name.trim().length === 0 ? 'Name is required' : null;

  const handleSubmit = () => {
    setAttempted(true);
    if (values.name.trim().length === 0) {
      haptic('error');
      return;
    }
    haptic('success');
    onSubmit();
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
          title="Name"
          placeholder="Enter your name"
          value={values.name}
          onChangeText={(v) => { onChange('name', v); }}
          isRequired
          errorMessage={nameError}
        />

        <DarkInputField
          title="Title"
          placeholder="Engineer, Founder, Designer..."
          value={values.title}
          onChangeText={(v) => { onChange('title', v); }}
        />

        <DarkInputField
          title="Company"
          placeholder="Your company"
          value={values.company}
          onChangeText={(v) => { onChange('company', v); }}
        />

        <View style={{ paddingTop: 16 }}>
          <ThemedButton
            label={submitLabel}
            variant="primary"
            fullWidth
            haptic={false}
            onPress={handleSubmit}
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
}

function DarkInputField({
  title,
  placeholder,
  value,
  onChangeText,
  isRequired = false,
  errorMessage = null,
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
