/**
 * Security & Keys — 1:1 port of
 * solidarity/Views/SettingsViews/SecuritySettingsView.swift.
 *
 * Two sections:
 *   1. Key Rotation — destructive "Rotate DID Master Key" row + footer.
 *   2. Biometric Requirements — per-action Face ID toggles (7 actions).
 *
 * Key rotation calls KeychainService.shared.resetSigningKey() in Swift; the
 * TS equivalent (resetSigningKeyForTesting + ensure*) lives in
 * src/keychain. Wiring it triggers a Face ID prompt via requireBiometric.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  SettingsBackToolbar,
  SettingsBlockDangerRow,
  SettingsBlockSection,
  SettingsBlockToggleRow,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { ensureSigningKey, requireBiometric, resetSigningKeyForTesting } from '@/keychain';
import {
  type SensitiveActionKey,
  usePreferences,
} from '@/settings/preferences';

/** Mirrors faceIdLabel(for:) switch in SecuritySettingsView. */
const FACE_ID_LABEL: Readonly<Record<SensitiveActionKey, string>> = {
  issueCredential: 'Require Face ID for issuance',
  presentProof: 'Require Face ID for proofs',
  exportGraph: 'Require Face ID for exports',
  rotateMasterKey: 'Require Face ID for key rotation',
  revealRecoveryBundle: 'Require Face ID for recovery',
  registerTrustAnchor: 'Require Face ID for trusted issuers',
  deleteZKIdentity: 'Require Face ID to delete ZK identity',
};

const ACTIONS: readonly SensitiveActionKey[] = [
  'issueCredential',
  'presentProof',
  'exportGraph',
  'rotateMasterKey',
  'revealRecoveryBundle',
  'registerTrustAnchor',
  'deleteZKIdentity',
];

export default function SecuritySettings() {
  const insets = useSafeAreaInsets();
  const policy = usePreferences((s) => s.biometricPolicy);
  const setPref = usePreferences((s) => s.set);
  const [rotating, setRotating] = useState(false);

  const setPolicy = (action: SensitiveActionKey, enabled: boolean) => {
    setPref('biometricPolicy', { ...policy, [action]: enabled });
  };

  const rotateMasterKey = async () => {
    if (rotating) return;
    setRotating(true);
    try {
      if (policy.rotateMasterKey) {
        const ok = await requireBiometric('delete');
        if (!ok) {
          setRotating(false);
          return;
        }
      }
      await resetSigningKeyForTesting();
      await ensureSigningKey();
      Alert.alert('Security', 'Master key rotated successfully.');
    } catch (err) {
      Alert.alert('Security', (err as Error).message);
    } finally {
      setRotating(false);
    }
  };

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar onPress={() => { router.back(); }} />
      <SettingsScreenTitle title="Security & Keys" />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 24, paddingBottom: 24 + insets.bottom }}
      >
        <View className="gap-6">
          {/* Key Rotation */}
          <SettingsBlockSection
            title="Key Rotation"
            footer="Rotating the master key will invalidate active verifiable credentials across your network until re-issued."
          >
            <SettingsBlockDangerRow
              icon="key.fill"
              title="Rotate DID Master Key"
              onPress={() => { void rotateMasterKey(); }}
            />
          </SettingsBlockSection>

          {/* Biometric Requirements */}
          <SettingsBlockSection title="Biometric Requirements">
            {ACTIONS.map((action) => (
              <SettingsBlockToggleRow
                key={action}
                icon="faceid"
                title={FACE_ID_LABEL[action]}
                value={policy[action]}
                onValueChange={(v) => { setPolicy(action, v); }}
              />
            ))}
          </SettingsBlockSection>
        </View>
      </ScrollView>
    </View>
  );
}
