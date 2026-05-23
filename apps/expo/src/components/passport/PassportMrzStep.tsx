/**
 * PassportMrzStep — extracted from app/passport/index.tsx so the page-level
 * orchestrator stays under the lint budget.
 *
 * Mirrors Swift PassportOnboardingFlowView.mrzForm — toggles between a
 * "Scan Passport / Manual Input" entry card and the manual-input field
 * stack pre-filled by the MRZ camera modal.
 */
import { Pressable, Text, TextInput, View } from 'react-native';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import type { PassportMRZDraft } from '@/passport/pipeline';

export function PassportMrzStep({
  showManualInput,
  setShowManualInput,
  draft,
  patch,
  onContinue,
  onScanPressed,
}: {
  readonly showManualInput: boolean;
  readonly setShowManualInput: (v: boolean) => void;
  readonly draft: PassportMRZDraft;
  readonly patch: (p: Partial<PassportMRZDraft>) => void;
  readonly onContinue: () => void;
  readonly onScanPressed: () => void;
}) {
  if (!showManualInput) {
    return (
      <View className="bg-mutedSurface gap-3 rounded-xl p-3.5">
        <ThemedButton
          label="Scan Passport"
          fullWidth
          leadingIcon={
            <SfIcon
              name="camera.viewfinder"
              size={15}
              weight="semibold"
              color={Colors.invertedButtonText}
            />
          }
          onPress={onScanPressed}
        />
        <Pressable
          onPress={() => { setShowManualInput(true); }}
          accessibilityRole="button"
          className="rounded-sm2 active:opacity-70"
          style={{
            paddingVertical: 12,
            alignItems: 'center',
            borderWidth: 1,
            borderColor: Colors.text1,
          }}
        >
          <Text className="text-text1 text-[15px]">Manual Input</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="bg-mutedSurface gap-2.5 rounded-xl p-3.5">
      <Field
        label="Passport Number"
        value={draft.passportNumber}
        onChangeText={(v) => { patch({ passportNumber: v.toUpperCase() }); }}
        autoCapitalize="characters"
      />
      <Field
        label="Nationality (3 letters)"
        value={draft.nationalityCode}
        onChangeText={(v) => { patch({ nationalityCode: v.toUpperCase() }); }}
        autoCapitalize="characters"
        maxLength={3}
      />
      <Field
        label="Date of Birth (YYMMDD)"
        value={draft.dateOfBirth}
        onChangeText={(v) => { patch({ dateOfBirth: v }); }}
        keyboardType="number-pad"
        maxLength={6}
      />
      <Field
        label="Expiry Date (YYMMDD)"
        value={draft.expiryDate}
        onChangeText={(v) => { patch({ expiryDate: v }); }}
        keyboardType="number-pad"
        maxLength={6}
      />
      <View className="pt-2">
        <ThemedButton label="Continue to NFC" fullWidth onPress={onContinue} />
      </View>
      <Pressable
        onPress={() => { setShowManualInput(false); }}
        accessibilityRole="button"
        className="self-center active:opacity-60"
      >
        <Text className="text-text2 text-[12px]">Back to Scan</Text>
      </Pressable>
    </View>
  );
}

function Field({
  label,
  ...inputProps
}: {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (v: string) => void;
  readonly autoCapitalize?: 'none' | 'characters';
  readonly keyboardType?: 'default' | 'number-pad';
  readonly maxLength?: number;
}) {
  return (
    <View className="gap-1">
      <Text className="text-text2 text-[12px]">{label}</Text>
      <TextInput
        autoCorrect={false}
        className="text-text1 rounded-sm2 bg-cardBg text-[15px]"
        style={{
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderWidth: 0.5,
          borderColor: Colors.divider,
        }}
        {...inputProps}
      />
    </View>
  );
}
