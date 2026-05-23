/**
 * SecureKeysStep — 1:1 port of `finalizeKeysStep` in Swift
 * OnboardingFlowView+Steps.swift.
 *
 * Body:
 *   "You're about to begin your journey.
 *    Please confirm to generate your DID keys."
 *
 * CTA: "Generate Secure Keys" (inverted). When working, a centered
 * progress spinner replaces the button. Mirrors Swift `setupKeychain()`
 * which probes for an iCloud backup before provisioning fresh keys.
 *
 * The native iCloud-restore probe lives in `BackupManager.probeLatestBackup`
 * on iOS; the Expo port wraps that via @/backup. For Android the restore
 * dialog never fires (Drive uses an explicit sign-in flow in
 * BackupChoiceStep).
 */
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { ThemedButton, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { ensureSigningKey } from '@/keychain';
import { pushToast } from '@/feedback/toast';
import { OnboardingScaffold } from './OnboardingScaffold';

export interface SecureKeysStepProps {
  readonly onBack: () => void;
  readonly onKeysGenerated: () => void;
}

export function SecureKeysStep({ onBack, onKeysGenerated }: SecureKeysStepProps) {
  const [isWorking, setIsWorking] = useState(false);

  const setupKeychain = async () => {
    setIsWorking(true);
    try {
      // Mirror Swift `provisionKeysAndContinue` — mint the master signing
      // key, then advance. The Swift app additionally probes iCloud for
      // a backup; that probe lives in @/backup and is invoked from the
      // BackupChoice step (split into its own UI gesture in the Expo port).
      await ensureSigningKey();
      onKeysGenerated();
    } catch (err) {
      pushToast(`Key generation failed: ${(err as Error).message}`, 'error');
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <OnboardingScaffold
      onBack={onBack}
      title="Secure Keys"
      subtitle={"You're about to begin your journey.\nPlease confirm to generate your DID keys."}
    >
      <View style={{ flex: 1 }} />

      {isWorking ? (
        <View style={{ alignItems: 'center' }}>
          <ActivityIndicator size="large" color={Colors.terminalGreen} />
        </View>
      ) : (
        <ThemedButton
          label="Generate Secure Keys"
          variant="inverted"
          fullWidth
          onPress={() => { void setupKeychain(); }}
        />
      )}

      <View style={{ flex: 1 }} />

      {/* Reserve trailing space to match Swift's two Spacer() rows */}
      <ThemedText> </ThemedText>
    </OnboardingScaffold>
  );
}
