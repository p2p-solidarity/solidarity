/**
 * PassportMrzStep — extracted from app/passport/index.tsx so the page-level
 * orchestrator stays under the lint budget.
 *
 * Mirrors Swift PassportOnboardingFlowView.mrzForm — toggles between a
 * "Scan Passport / Manual Input" entry card and the manual-input field
 * stack pre-filled by the MRZ camera modal.
 *
 * Date entry: user types YYYY/MM/DD (auto-formatted). Stored on the draft
 * as the MRZ-native YYMMDD because the BAC/PACE key derivation hashes that
 * 6-char string verbatim — see passport/pipeline.parseYyMmDd.
 */
import { Pressable, Text, TextInput, View } from 'react-native';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import type { PassportMRZDraft } from '@/passport/pipeline';

/** Convert raw digit input → display `YYYY/MM/DD` (truncates >8 digits). */
function formatYyyyMmDd(digits: string): string {
  const d = digits.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 4) return d;
  if (d.length <= 6) return `${d.slice(0, 4)}/${d.slice(4)}`;
  return `${d.slice(0, 4)}/${d.slice(4, 6)}/${d.slice(6)}`;
}

/** Display `YYYY/MM/DD` → MRZ-native YYMMDD (last 6 digits). */
function toMrzYyMmDd(display: string): string {
  const digits = display.replace(/\D/g, '');
  if (digits.length !== 8) return digits.slice(-6); // partial; validator will catch
  return digits.slice(2);
}

/** MRZ YYMMDD → display `YYYY/MM/DD`. Birth years 30+ → 1900s, else 2000s. */
function fromMrzYyMmDd(mrz: string): string {
  if (mrz.length !== 6) return '';
  const yy = Number(mrz.slice(0, 2));
  if (Number.isNaN(yy)) return '';
  const century = yy >= 30 ? '19' : '20';
  return `${century}${mrz.slice(0, 2)}/${mrz.slice(2, 4)}/${mrz.slice(4, 6)}`;
}

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
        label="Date of Birth (YYYY/MM/DD)"
        value={fromMrzYyMmDd(draft.dateOfBirth)}
        onChangeText={(v) => {
          const display = formatYyyyMmDd(v);
          patch({ dateOfBirth: toMrzYyMmDd(display) });
        }}
        placeholder="1990/01/15"
        keyboardType="number-pad"
        maxLength={10}
      />
      <Field
        label="Expiry Date (YYYY/MM/DD)"
        value={fromMrzYyMmDd(draft.expiryDate)}
        onChangeText={(v) => {
          const display = formatYyyyMmDd(v);
          patch({ expiryDate: toMrzYyMmDd(display) });
        }}
        placeholder="2030/12/31"
        keyboardType="number-pad"
        maxLength={10}
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
  readonly placeholder?: string;
}) {
  return (
    <View className="gap-1">
      <Text className="text-text2 text-[12px]">{label}</Text>
      <TextInput
        autoCorrect={false}
        placeholderTextColor={Colors.text3}
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
