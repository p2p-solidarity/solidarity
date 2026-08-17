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
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { BackupRestoreError, probeLatestBackup, restoreFromBackup } from '@/backup';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { showError } from '@/feedback/appAlert';
import { confirmDialog } from '@/feedback/confirmDialog';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { restoreRootKeyFromICloud } from '@/identity';
import { ensureSigningKey, hasExistingSigningKey } from '@/keychain';
import { CloudSyncPulse } from './CloudSyncPulse';
import { OnboardingScaffold } from './OnboardingScaffold';
import { waitForSyncedSigningKey } from './secureKeysStepLogic';

export interface SecureKeysStepProps {
  readonly onBack: () => void;
  readonly onKeysGenerated: () => void;
}

export function SecureKeysStep({ onBack, onKeysGenerated }: SecureKeysStepProps) {
  const { t } = useTranslation();
  const [isWorking, setIsWorking] = useState(false);
  const [statusLabel, setStatusLabel] = useState<string | null>(null);
  const [waitingForSync, setWaitingForSync] = useState(false);

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
      // Couldn't decrypt / read the backup — surface the SPECIFIC reason but
      // still let the user into the app. `root-key-unavailable` means the
      // portable archive needs the Recovery Phrase (recover identity first).
      const summary =
        err instanceof BackupRestoreError && err.kind === 'root-key-unavailable'
          ? t('backup.restore.rootKeyUnavailable')
          : t('backup.restore.failedSummary');
      showError({
        context: 'Onboarding › Restore from iCloud',
        summary,
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
      // 1. Recover the portable Root Identity FIRST (iOS iCloud Keychain
      //    read-back) so the Portable Backup Key exists BEFORE we try to
      //    restore the archive — a v2 archive can't be decrypted otherwise.
      //    `restoreRootKeyFromICloud` is local-wins (never overwrites an
      //    existing local identity, so it can't silently switch identities —
      //    the Codex DID-switch concern) and treats a malformed synced phrase
      //    as an error, never a silent fresh mint. A genuinely new user gets
      //    `notFound` and provisions fresh in the Backup step. iOS-only:
      //    Android recovers via manual phrase entry (Settings › identity).
      let recoveredFromICloud = false;
      if (Platform.OS === 'ios') {
        const recovery = await restoreRootKeyFromICloud();
        if (!recovery.ok) {
          // Surface but never block entry — the user can enter their phrase later.
          showError({
            context: 'Onboarding › Recover Identity',
            summary: t('backup.recoverIdentityFailed'),
            error: new Error(recovery.error.kind),
          });
        } else {
          recoveredFromICloud = recovery.value.kind === 'restoredFromICloud';
        }
      }
      // 2. T7 gate: a root identity recovered from iCloud proves this user's
      //    signing key exists in iCloud Keychain — give replication a bounded
      //    window before ensureSigningKey would mint a competitor key. The
      //    ensure below still runs on every outcome: key existence at the end
      //    of this step is a hard guarantee, the wait only shrinks the race.
      if (recoveredFromICloud && !(await hasExistingSigningKey())) {
        setWaitingForSync(true);
        setStatusLabel(t('secureKeys.waitingForICloud'));
        await waitForSyncedSigningKey({
          attempts: 6,
          intervalMs: 2500,
          probe: hasExistingSigningKey,
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        });
        setWaitingForSync(false);
        setStatusLabel(null);
      }
      //    Provision the Signing Identity (idempotent — reused if it exists).
      await ensureSigningKey();
      // 3. Offer to restore the Backup Archive (portable key now available).
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
          {waitingForSync ? (
            <CloudSyncPulse />
          ) : (
            <SecureKeyPulse />
          )}
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

function SecureKeyPulse() {
  const reduceMotion = useReducedMotion();
  const phase = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) return;
    phase.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 620, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 520, easing: Easing.inOut(Easing.quad) })
      ),
      -1
    );
    return () => {
      cancelAnimation(phase);
    };
  }, [phase, reduceMotion]);

  const ringStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion ? 0.28 : 0.18 + phase.value * 0.18,
    transform: [{ scale: reduceMotion ? 1 : 0.82 + phase.value * 0.3 }],
  }));
  const keyStyle = useAnimatedStyle(() => ({
    transform: [{ scale: reduceMotion ? 1 : 0.96 + phase.value * 0.06 }],
  }));

  return (
    <View style={{ width: 74, height: 74, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: 74,
            height: 74,
            borderRadius: 37,
            borderWidth: 1,
            borderColor: Colors.terminalGreen,
          },
          ringStyle,
        ]}
      />
      <Animated.View
        style={[
          {
            width: 52,
            height: 52,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: Colors.divider,
            backgroundColor: Colors.cardBg,
            alignItems: 'center',
            justifyContent: 'center',
          },
          keyStyle,
        ]}>
        <SfIcon name="key.fill" size={24} color={Colors.terminalGreen} />
      </Animated.View>
      <View style={{ position: 'absolute', right: 0, bottom: 0 }}>
        <ActivityIndicator size="small" color={Colors.primaryBlue} />
      </View>
    </View>
  );
}
