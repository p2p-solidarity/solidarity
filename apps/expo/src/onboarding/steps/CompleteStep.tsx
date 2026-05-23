/**
 * CompleteStep — 1:1 port of `finalCompletionStep` in Swift
 * OnboardingFlowView+Steps.swift.
 *
 *   [ SYSTEM READY ]              (32pt monospaced bold, terminalGreen,
 *                                  with soft glow shadow)
 *
 *   ┌────────────────────────────┐
 *   │ ✓ Profile                  │
 *   │   Ada Lovelace             │
 *   │ ✓ Key Pair                 │
 *   │   Generated                │
 *   │ ○ Contacts                 │
 *   │   Skipped                  │
 *   │ ○ Passport                 │
 *   │   Skipped                  │
 *   └────────────────────────────┘
 *
 *   [ Start Using Solidarity ]   (inverted CTA)
 */
import { Platform, View } from 'react-native';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';

export interface CompleteStepProps {
  readonly username: string;
  readonly keysGenerated: boolean;
  readonly importedCount: number | null;
  readonly passportScanned: boolean;
  readonly onFinish: () => void;
}

export function CompleteStep({
  username,
  keysGenerated,
  importedCount,
  passportScanned,
  onFinish,
}: CompleteStepProps) {
  const handleFinish = () => {
    haptic('success');
    onFinish();
  };

  const trimmedName = username.trim();

  return (
    <View
      className="bg-pageBg flex-1"
      style={{ paddingHorizontal: 24, paddingTop: 80, paddingBottom: 40, gap: 24 }}
    >
      <View style={{ flex: 1 }} />

      <View style={{ alignItems: 'center' }}>
        <ThemedText
          variant="headlineLarge"
          style={{
            color: Colors.terminalGreen,
            fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
            ...(Platform.OS === 'ios'
              ? { textShadowColor: `${Colors.terminalGreen}80`, textShadowRadius: 10 }
              : {}),
          }}
        >
          [ SYSTEM READY ]
        </ThemedText>
      </View>

      <View
        style={{
          padding: 16,
          backgroundColor: Colors.searchBg,
          borderWidth: 1,
          borderColor: Colors.divider,
          gap: 12,
        }}
      >
        <CompletionRow
          title="Profile"
          done={trimmedName.length > 0}
          detail={trimmedName.length > 0 ? trimmedName : 'Not set'}
        />
        <CompletionRow
          title="Key Pair"
          done={keysGenerated}
          detail={keysGenerated ? 'Generated' : 'Not created'}
        />
        <CompletionRow
          title="Contacts"
          done={(importedCount ?? 0) > 0}
          detail={importedCount !== null ? `${String(importedCount)} imported` : 'Skipped'}
        />
        <CompletionRow
          title="Passport"
          done={passportScanned}
          detail={passportScanned ? 'Credential created' : 'Skipped'}
        />
      </View>

      <View style={{ flex: 1 }} />

      <ThemedButton
        label="Start Using Solidarity"
        variant="inverted"
        fullWidth
        haptic={false}
        onPress={handleFinish}
      />
    </View>
  );
}

function CompletionRow({
  title,
  done,
  detail,
}: {
  title: string;
  done: boolean;
  detail: string;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <SfIcon
        name={done ? 'checkmark.circle.fill' : 'circle'}
        size={18}
        color={done ? Colors.terminalGreen : Colors.text3}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <ThemedText
          variant="bodySmall"
          style={{ fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontWeight: '600' }}
        >
          {title}
        </ThemedText>
        <ThemedText variant="caption" tone="secondary">
          {detail}
        </ThemedText>
      </View>
    </View>
  );
}
