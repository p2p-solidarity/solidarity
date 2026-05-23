/**
 * ScanPassportStep — 1:1 port of `scanPassportStep` in Swift
 * OnboardingFlowView+Steps.swift.
 *
 * Body:
 *   "Scan your passport to unlock provable claims.
 *    You can prove your age or personhood without revealing personal info."
 *
 * Actions:
 *   - "Passport credential created" success badge once scanned.
 *   - "Scan Passport" (primary) — opens the PassportOnboardingFlowView modal.
 *
 * Footer: "Continue" if scanned, otherwise "Skip" (both inverted CTA).
 */
import type { ReactNode } from 'react';
import { router } from 'expo-router';
import { View } from 'react-native';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { OnboardingScaffold } from './OnboardingScaffold';

export interface ScanPassportStepProps {
  readonly passportScanned: boolean;
  readonly onBack: () => void;
  readonly onAdvance: () => void;
}

export function ScanPassportStep({
  passportScanned,
  onBack,
  onAdvance,
}: ScanPassportStepProps) {
  const openPassportFlow = () => {
    // Swift presents PassportOnboardingFlowView as a fullScreenCover. In
    // Expo Router we navigate to /passport which lives at app/passport/index.tsx.
    router.push('/passport');
  };

  return (
    <OnboardingScaffold
      onBack={onBack}
      title="Scan Passport"
      subtitle={
        'Scan your passport to unlock provable claims.\nYou can prove your age or personhood without revealing personal info.'
      }
      footer={
        <ThemedButton
          label={passportScanned ? 'Continue' : 'Skip'}
          variant="inverted"
          fullWidth
          onPress={onAdvance}
        />
      }
    >
      <View style={{ flex: 1 }} />

      <View style={{ gap: 16 }}>
        {passportScanned ? <PassportCreatedBadge /> : null}

        {!passportScanned ? (
          <ThemedButton
            label="Scan Passport"
            fullWidth
            leadingIcon={<SfIcon name="doc.viewfinder" size={17} color={Colors.invertedButtonText} />}
            onPress={openPassportFlow}
          />
        ) : null}
      </View>

      <View style={{ flex: 1 }} />
    </OnboardingScaffold>
  );
}

function PassportCreatedBadge(): ReactNode {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 10,
        borderWidth: 1,
        borderColor: `${Colors.terminalGreen}4D`,
        backgroundColor: `${Colors.terminalGreen}14`,
      }}
    >
      <SfIcon name="checkmark.circle.fill" size={18} color={Colors.terminalGreen} />
      <ThemedText
        variant="bodyMedium"
        style={{ color: Colors.terminalGreen, fontFamily: 'Menlo', fontWeight: '600' }}
      >
        Passport credential created
      </ThemedText>
    </View>
  );
}
