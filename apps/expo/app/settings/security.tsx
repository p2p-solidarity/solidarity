/**
 * Security — one mode picker, one destructive action.
 *
 * Sections:
 *   1. Biometric Authentication header + subtitle (matches the
 *      `NSFaceIDUsageDescription` plist string).
 *   2. Face ID Protection — the three `BiometricGateMode` rows, plus a footer
 *      naming the red line no mode disarms.
 *   3. Sign-in Access — destructive "Replace Secure Sign-in" row + footer.
 *
 * This screen used to render 7 per-action toggles and 7 two-way "biometric
 * only / biometric or passcode" segmented controls (a 1:1 port of Swift's
 * `SecuritySettingsView`). Users have no basis for deciding "should exporting
 * contacts need Face ID but presenting a proof not?", so the app decides —
 * and offers the one axis people actually reason about: how often to ask.
 *
 * COPY HONESTY: every `requireBiometric` call site in the app was migrated onto
 * `requireSensitiveAction` alongside this screen, so a mode now governs the
 * whole app rather than the handful of screens that happened to consult the
 * policy. The two deliberate exceptions are documented in
 * `src/keychain/sensitiveActionPolicy.ts`. Do not add copy here describing a
 * guarantee without checking the call site actually routes through the gate —
 * an earlier version claimed a recovery-data floor that did not exist.
 *
 * Rule 8 (3-state UI): while the mode is hydrating we render a skeleton row so
 * we never flash the wrong selection and let the user "confirm" a value that
 * was never theirs.
 */
import { safeBack } from '@/navigation/safeBack';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SfIcon } from '@/components/icons/SfIcon';
import { appAlert, showError } from '@/feedback/appAlert';
import {
  SettingsBackToolbar,
  SettingsBlockDangerRow,
  SettingsBlockSection,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { Colors } from '@/constants/Colors';
import { useThemeColors } from '@/constants/useThemeColors';
import { useTranslation } from '@/i18n';
import {
  BIOMETRIC_GATE_MODES,
  ensureSigningKey,
  hydrateSensitiveActionPolicy,
  requireSensitiveAction,
  resetSigningKeyForTesting,
  useSensitiveActionPolicy,
  type BiometricGateMode,
} from '@/keychain';

type ModeIcon = 'faceid' | 'clock.fill' | 'exclamationmark.shield.fill';

/** `BIOMETRIC_GATE_MODES` is ordered strongest → weakest; icons follow it. */
const MODE_ICON: Readonly<Record<BiometricGateMode, ModeIcon>> = {
  everyTime: 'faceid',
  balanced: 'clock.fill',
  redLineOnly: 'exclamationmark.shield.fill',
};

export default function SecuritySettings() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  const mode = useSensitiveActionPolicy((s) => s.mode);
  const hydrated = useSensitiveActionPolicy((s) => s.hydrated);
  const setMode = useSensitiveActionPolicy((s) => s.setMode);

  const [rotating, setRotating] = useState(false);
  const [gating, setGating] = useState(false);

  // Boot calls `hydrateSensitiveActionPolicy()` from the middle of a try block
  // (`app/_layout.tsx`); if anything before it throws, the catch still paints
  // the app and this store stays unhydrated for the whole session. Retry on
  // mount so the picker can never be stuck behind its loading row.
  useEffect(() => {
    if (!hydrated) hydrateSensitiveActionPolicy();
  }, [hydrated]);

  /**
   * Weakening the mode is itself a sensitive action: without this, anyone
   * holding the already-unlocked phone drops to `redLineOnly` in one tap and
   * then exports at leisure. Strengthening needs no proof — that direction only
   * ever adds protection.
   *
   * `rotateMasterKey` is the action key because it carries the semantics we
   * need (red line, never rides the grace window); the user-visible copy is the
   * `reason` argument, which describes what is actually happening.
   */
  const onSelectMode = (next: BiometricGateMode): void => {
    if (next === mode || gating) return;
    const weakening =
      BIOMETRIC_GATE_MODES.indexOf(next) > BIOMETRIC_GATE_MODES.indexOf(mode);
    if (!weakening) {
      setMode(next);
      return;
    }
    setGating(true);
    void (async () => {
      try {
        const gate = await requireSensitiveAction(
          'rotateMasterKey',
          t('security.prompt.weakenGate')
        );
        if (!gate.success) {
          appAlert({
            title: t('security.alertTitle'),
            message: t(`security.error.${gate.reason}`),
          });
          return;
        }
        setMode(next);
      } catch (err) {
        showError({
          context: 'Security › Change Face ID mode',
          summary: t('security.alertTitle'),
          error: err,
        });
      } finally {
        setGating(false);
      }
    })();
  };

  const rotateMasterKey = async (): Promise<void> => {
    if (rotating) return;
    setRotating(true);
    try {
      // `rotateMasterKey` is a RED LINE action — the gate runs in every mode,
      // so there is no policy pre-check here on purpose.
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
      <SettingsBackToolbar onPress={() => { safeBack('/settings'); }} />
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
            title={t('security.section.protection')}
            footer={t('security.gate.footer')}
          >
            {hydrated ? (
              BIOMETRIC_GATE_MODES.map((option, index) => (
                <ModeRow
                  key={option}
                  icon={MODE_ICON[option]}
                  title={t(`security.mode.${option}.title`)}
                  subtitle={t(`security.mode.${option}.subtitle`)}
                  selected={option === mode}
                  disabled={gating}
                  isLast={index === BIOMETRIC_GATE_MODES.length - 1}
                  onPress={() => { onSelectMode(option); }}
                />
              ))
            ) : (
              <GateSkeleton label={t('security.gate.loading')} />
            )}
          </SettingsBlockSection>

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
        </View>
      </ScrollView>
    </View>
  );
}

interface ModeRowProps {
  readonly icon: ModeIcon;
  readonly title: string;
  readonly subtitle: string;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly isLast: boolean;
  readonly onPress: () => void;
}

/**
 * A single-select row. Checkmark rather than a radio dot, so the chosen mode
 * reads at a glance and the block matches the rest of Settings.
 */
function ModeRow({ icon, title, subtitle, selected, disabled, isLast, onPress }: ModeRowProps) {
  const c = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={title}
      accessibilityHint={subtitle}
      className="flex-row items-center bg-cardBg active:opacity-80"
      style={{
        paddingHorizontal: 14,
        paddingVertical: 12,
        minHeight: 44,
        opacity: disabled ? 0.5 : 1,
        borderBottomWidth: isLast ? 0 : 0.5,
        borderBottomColor: c.divider,
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
        <SfIcon name={icon} size={14} color={selected ? Colors.primaryBlue : c.text2} />
      </View>
      <View className="flex-1">
        <Text className="text-[15px] text-text1">{title}</Text>
        <Text className="text-[12px] text-text3" style={{ marginTop: 2 }}>
          {subtitle}
        </Text>
      </View>
      {selected ? <SfIcon name="checkmark" size={14} color={Colors.primaryBlue} /> : null}
    </Pressable>
  );
}

/**
 * Loading state for the picker. Deliberately shows no selection at all rather
 * than a plausible-looking one on a guessed row (Rule 8).
 */
function GateSkeleton({ label }: { readonly label: string }) {
  return (
    <View
      className="flex-row items-center bg-cardBg"
      accessibilityLabel={label}
      style={{ paddingHorizontal: 14, paddingVertical: 12, minHeight: 44, opacity: 0.5 }}
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
  );
}
