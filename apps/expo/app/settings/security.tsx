/**
 * Security & Keys — 1:1 port of
 * solidarity/Views/SettingsViews/SecuritySettingsView.swift.
 *
 * Sections:
 *   1. Biometric Authentication header + subtitle (matches the
 *      `NSFaceIDUsageDescription` plist string).
 *   2. Key Rotation — destructive "Rotate DID Master Key" row + footer.
 *   3. Biometric Requirements — per-action toggle + segmented "biometric only
 *      vs biometric or passcode" control (mirrors the Swift LAPolicy split).
 *   4. Reset to defaults footer button.
 *
 * Storage: the per-action policy lives in `useSensitiveActionPolicy`
 * (MMKV-backed, see `src/keychain/sensitiveActionPolicy.ts`). The legacy
 * `usePreferences.biometricPolicy` map is still kept in sync for parity
 * tests + screens that haven't migrated yet — `setRequirement` updates
 * both so a single source of truth remains visible to callers.
 *
 * Rule 8 (3-state UI): while the policy is hydrating we render a tiny
 * skeleton list so we never flash "biometric off" defaults to the user.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SfIcon } from '@/components/icons/SfIcon';
import { appAlert, showError } from '@/feedback/appAlert';
import {
  SettingsBackToolbar,
  SettingsBlockDangerRow,
  SettingsBlockSection,
  SettingsBlockToggleRow,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';
import {
  SENSITIVE_ACTIONS,
  ensureSigningKey,
  requireSensitiveAction,
  resetSigningKeyForTesting,
  useSensitiveActionPolicy,
  type BiometricMode,
  type SensitiveAction,
  type SensitiveActionEntry,
} from '@/keychain';
import {
  usePreferences,
  type SensitiveActionKey,
} from '@/settings/preferences';

const MODES: readonly BiometricMode[] = ['biometricOnly', 'biometricOrPasscode'];

export default function SecuritySettings() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  const policy = useSensitiveActionPolicy((s) => s.policy);
  const hydrated = useSensitiveActionPolicy((s) => s.hydrated);
  const setPolicy = useSensitiveActionPolicy((s) => s.setPolicy);
  const togglePolicy = useSensitiveActionPolicy((s) => s.togglePolicy);
  const resetToDefaults = useSensitiveActionPolicy((s) => s.resetToDefaults);

  const setPref = usePreferences((s) => s.set);
  const legacyPolicy = usePreferences((s) => s.biometricPolicy);

  const [rotating, setRotating] = useState(false);

  /**
   * Keep the legacy `usePreferences.biometricPolicy` map in lockstep with
   * the dedicated policy store so older call sites (and the parity test)
   * continue to see a consistent value. The two stores intentionally have
   * the same key set — `SensitiveActionKey` is a structural alias for
   * `SensitiveAction`.
   */
  const writeLegacyEnabled = (action: SensitiveAction, enabled: boolean): void => {
    // SensitiveAction values mirror SensitiveActionKey 1:1 — no cast needed.
    const next: Record<SensitiveActionKey, boolean> = { ...legacyPolicy, [action]: enabled };
    setPref('biometricPolicy', next);
  };

  const onToggle = (action: SensitiveAction): void => {
    togglePolicy(action);
    const current = policy[action];
    writeLegacyEnabled(action, !current.enabled);
  };

  const onSetMode = (action: SensitiveAction, mode: BiometricMode): void => {
    const current = policy[action];
    setPolicy(action, { ...current, mode });
  };

  const onReset = (): void => {
    resetToDefaults();
    for (const action of SENSITIVE_ACTIONS) {
      writeLegacyEnabled(action, true);
    }
  };

  const rotateMasterKey = async (): Promise<void> => {
    if (rotating) return;
    setRotating(true);
    try {
      if (policy.rotateMasterKey.enabled) {
        const result = await requireSensitiveAction(
          'rotateMasterKey',
          t('security.prompt.rotateMasterKey')
        );
        if (!result.success) {
          appAlert({
            title: t('security.alertTitle'),
            message: t(`security.error.${result.reason}`),
          });
          setRotating(false);
          return;
        }
      }
      await resetSigningKeyForTesting();
      await ensureSigningKey();
      appAlert({ title: t('security.alertTitle'), message: t('security.rotation.success') });
    } catch (err) {
      showError({
        context: 'Security › Rotate Master Key',
        summary: t('security.alertTitle'),
        error: err,
      });
    } finally {
      setRotating(false);
    }
  };

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar onPress={() => { router.back(); }} />
      <SettingsScreenTitle title={t('security.title')} />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 24 + insets.bottom }}
      >
        <View className="gap-6">
          <View className="gap-1 px-4">
            <Text className="text-text1 text-[17px] font-semibold">
              {t('security.header')}
            </Text>
            <Text className="text-text3 text-[13px]">{t('security.subtitle')}</Text>
          </View>

          <SettingsBlockSection
            title={t('security.section.keyRotation')}
            footer={t('security.section.keyRotationFooter')}
          >
            <SettingsBlockDangerRow
              icon="key.fill"
              title={t('security.action.rotateMasterKeyTitle')}
              onPress={() => { void rotateMasterKey(); }}
            />
          </SettingsBlockSection>

          <SettingsBlockSection title={t('security.section.requirements')}>
            {!hydrated
              ? renderSkeleton()
              : SENSITIVE_ACTIONS.map((action) => (
                  <PolicyRow
                    key={action}
                    action={action}
                    entry={policy[action]}
                    label={t(faceIdLabelKey(action))}
                    onToggle={() => { onToggle(action); }}
                    onSetMode={(mode) => { onSetMode(action, mode); }}
                  />
                ))}
          </SettingsBlockSection>

          <View className="px-4">
            <Pressable
              onPress={onReset}
              accessibilityRole="button"
              accessibilityLabel={t('security.resetDefaults')}
              className="rounded-xl bg-mutedSurface active:opacity-80"
              style={{ paddingHorizontal: 14, paddingVertical: 14, alignItems: 'center' }}
            >
              <Text className="text-text1 text-[15px]">{t('security.resetDefaults')}</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

interface PolicyRowProps {
  readonly action: SensitiveAction;
  readonly entry: SensitiveActionEntry;
  readonly label: string;
  readonly onToggle: () => void;
  readonly onSetMode: (mode: BiometricMode) => void;
}

function PolicyRow({ entry, label, onToggle, onSetMode }: PolicyRowProps) {
  const { t } = useTranslation();
  return (
    <View className="gap-2">
      <SettingsBlockToggleRow
        icon="faceid"
        title={label}
        value={entry.enabled}
        onValueChange={onToggle}
      />
      {entry.enabled ? (
        <View
          className="flex-row gap-2"
          style={{ paddingHorizontal: 14, paddingVertical: 8 }}
        >
          {MODES.map((mode) => (
            <ModeChip
              key={mode}
              label={t(`security.mode.${mode}`)}
              selected={entry.mode === mode}
              onPress={() => { onSetMode(mode); }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ModeChip({
  label,
  selected,
  onPress,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      className="rounded-md active:opacity-80"
      style={{
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderWidth: 0.5,
        borderColor: selected ? Colors.primaryBlue : Colors.divider,
        backgroundColor: selected ? Colors.chipSurface : 'transparent',
      }}
    >
      <Text
        className="text-[12px]"
        style={{ color: selected ? Colors.text1 : Colors.text2 }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function renderSkeleton() {
  return (
    <View className="gap-2" accessibilityLabel="Loading biometric policy">
      {SENSITIVE_ACTIONS.map((action) => (
        <View
          key={action}
          className="rounded-xl bg-mutedSurface flex-row items-center"
          style={{
            paddingHorizontal: 14,
            paddingVertical: 12,
            opacity: 0.5,
            minHeight: 44,
          }}
        >
          <View
            style={{
              width: 20,
              height: 20,
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: 12,
            }}
          >
            <SfIcon name="faceid" size={14} color={Colors.text3} />
          </View>
          <View style={{ height: 12, width: 160, backgroundColor: Colors.divider, borderRadius: 4 }} />
        </View>
      ))}
    </View>
  );
}

/** Mirrors `faceIdLabel(for:)` switch in `SecuritySettingsView.swift`. */
function faceIdLabelKey(action: SensitiveAction): string {
  switch (action) {
    case 'issueCredential':
      return 'security.label.issueCredential';
    case 'presentProof':
      return 'security.label.presentProof';
    case 'exportGraph':
      return 'security.label.exportGraph';
    case 'rotateMasterKey':
      return 'security.label.rotateMasterKey';
    case 'revealRecoveryBundle':
      return 'security.label.revealRecoveryBundle';
    case 'registerTrustAnchor':
      return 'security.label.registerTrustAnchor';
    case 'deleteZKIdentity':
      return 'security.label.deleteZKIdentity';
  }
}
