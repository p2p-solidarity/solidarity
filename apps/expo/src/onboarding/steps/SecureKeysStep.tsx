/**
 * SecureKeysStep — 1:1 port of `finalizeKeysStep` in Swift
 * OnboardingFlowView+Steps.swift.
 *
 * Body:
 *   "You're about to begin your journey.
 *    Please confirm to generate your DID keys."
 *
 * CTA: "Generate Secure Keys" (inverted). When working, a centered
 * progress spinner replaces the button.
 *
 * Mirrors Swift `setupKeychain()` → `provisionKeysAndContinue`: after
 * provisioning the master signing key we probe iCloud for an existing
 * backup (BackupManager.probeLatestBackup). If one is found we offer a
 * themed "Restore from iCloud?" prompt (Restore / Start Fresh) before
 * entering the app — so a returning user recovers their cards, contacts,
 * and credentials instead of starting fresh. Errors are absorbed into the
 * themed report sheet, never a native alert.
 */
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { probeLatestBackup, restoreFromBackup } from '@/backup';
import { ThemedButton, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { showError } from '@/feedback/appAlert';
import { confirmDialog } from '@/feedback/confirmDialog';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { ensureSigningKey } from '@/keychain';
import { OnboardingScaffold } from './OnboardingScaffold';

export interface SecureKeysStepProps {
  readonly onBack: () => void;
  readonly onKeysGenerated: () => void;
}

export function SecureKeysStep({ onBack, onKeysGenerated }: SecureKeysStepProps) {
  const { t } = useTranslation();
  const [isWorking, setIsWorking] = useState(false);
  const [statusLabel, setStatusLabel] = useState<string | null>(null);

  const maybeRestore = async () => {
    // Probe needs no key (it only reads the backup file's mtime). A returning
    // user with an iCloud backup is offered a restore before entering.
    const probe = await probeLatestBackup().catch(() => null);
    if (!probe) return;
    const restore = await confirmDialog({
      title: t('backup.icloudRestore.title'),
      message: t('backup.icloudRestore.message', {
        date: probe.timestamp.toLocaleDateString(),
      }),
      confirmLabel: t('backup.icloudRestore.restore'),
      cancelLabel: t('backup.icloudRestore.startFresh'),
    });
    if (!restore) return;
    setStatusLabel(t('backup.restoring'));
    try {
      const result = await restoreFromBackup();
      if (result) {
        pushToast(
          t('backup.restore.success', {
            cards: result.cardsRestored,
            contacts: result.contactsRestored,
          }),
          'success'
        );
      }
    } catch (err) {
      // Couldn't decrypt / read the backup — surface it, but still let the
      // user into the app with freshly-provisioned keys.
      showError({
        context: 'Onboarding › Restore from iCloud',
        summary: t('backup.restore.failedSummary'),
        title: t('backup.restoreFailed.title'),
        error: err,
      });
    } finally {
      setStatusLabel(null);
    }
  };

  const setupKeychain = async () => {
    setIsWorking(true);
    try {
      // Provision the master signing key first so the restore step has a key
      // to decrypt with, then offer to restore an existing iCloud backup.
      await ensureSigningKey();
      await maybeRestore();
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
        <View style={{ alignItems: 'center', gap: 12 }}>
          <ActivityIndicator size="large" color={Colors.terminalGreen} />
          {statusLabel ? (
            <ThemedText variant="bodyMedium" tone="secondary">
              {statusLabel}
            </ThemedText>
          ) : null}
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
