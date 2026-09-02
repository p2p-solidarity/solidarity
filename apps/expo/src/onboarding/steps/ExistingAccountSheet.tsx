import { Platform, View } from 'react-native';
import { useState, type ReactNode } from 'react';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { probeLatestBackup, restoreFromBackup } from '@/backup';
import { ModalSheet } from '@/components/common/ModalSheet';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedSurface, ThemedText, ThemedTextInput } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { showError } from '@/feedback/appAlert';
import { haptic } from '@/feedback/haptics';
import { useTranslation } from '@/i18n';
import { importFromMnemonic, restoreRootKeyFromICloud } from '@/identity';
import { ensureSigningKey, hasExistingSigningKey, requireBiometric } from '@/keychain';

export function ExistingAccountSheet({
  visible,
  onClose,
  onRecovered,
}: {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onRecovered: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<'options' | 'phrase'>('options');
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);

  const finish = (): void => {
    haptic('success');
    setPhase('options');
    setPhrase('');
    onRecovered();
  };

  const run = async (action: () => Promise<void>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      haptic('error');
      showError({
        context: 'Onboarding › Sign In',
        summary: t('login.failed'),
        error,
      });
    } finally {
      setBusy(false);
    }
  };

  const signInOnDevice = async (): Promise<void> => {
    if (!(await hasExistingSigningKey())) throw new Error('No synced sign-in key');
    if (!(await requireBiometric('sign'))) return;
    finish();
  };

  const restoreIcloud = async (): Promise<void> => {
    const root = await restoreRootKeyFromICloud();
    if (!root.ok || root.value.kind === 'notFound') {
      throw new Error(root.ok ? 'No iCloud recovery was found' : root.error.kind);
    }
    await ensureSigningKey();
    const backup = await probeLatestBackup();
    if (backup !== null) await restoreFromBackup();
    finish();
  };

  const restorePhrase = async (): Promise<void> => {
    const imported = await importFromMnemonic(phrase);
    if (!imported.ok) throw new Error(imported.error.kind);
    await ensureSigningKey();
    finish();
  };

  return (
    <ModalSheet visible={visible} onRequestClose={onClose}>
      <View className="flex-1 bg-pageBg">
        <KeyboardAwareScrollView
          keyboardShouldPersistTaps="handled"
          bottomOffset={16}
          contentContainerStyle={{
            flexGrow: 1,
            paddingTop: insets.top + 16,
            paddingBottom: insets.bottom + 16,
          }}>
          <View className="flex-1 gap-5 px-4">
            <ThemedText variant="headlineMedium">
              {t(phase === 'options' ? 'login.title' : 'login.phrase')}
            </ThemedText>

            {phase === 'options' ? (
              <View style={{ gap: 10 }}>
                <RecoveryOption
                  icon="faceid"
                  title={t('login.faceid')}
                  subtitle={t('login.faceid.sub')}
                  disabled={busy}
                  onPress={() => { void run(signInOnDevice); }}
                />
                {Platform.OS === 'ios' ? (
                  <RecoveryOption
                    icon="icloud"
                    title={t('login.icloud')}
                    subtitle={t('login.icloud.sub')}
                    disabled={busy}
                    onPress={() => { void run(restoreIcloud); }}
                  />
                ) : null}
                <RecoveryOption
                  icon="square.and.pencil"
                  title={t('login.phrase')}
                  subtitle={t('login.phrase.sub')}
                  disabled={busy}
                  onPress={() => { setPhase('phrase'); }}
                />
              </View>
            ) : (
              <View style={{ gap: 16 }}>
                <ThemedTextInput
                  kind="secret"
                  value={phrase}
                  onChangeText={setPhrase}
                  placeholder={t('login.phrase.placeholder')}
                  multiline
                />
                <ThemedButton
                  label={t('login.phrase.restore')}
                  variant="primary"
                  fullWidth
                  loading={busy}
                  disabled={phrase.trim().length === 0}
                  onPress={() => { void run(restorePhrase); }}
                />
                <ThemedButton
                  label={t('onboarding.back')}
                  variant="secondary"
                  fullWidth
                  disabled={busy}
                  onPress={() => { setPhase('options'); }}
                />
              </View>
            )}
          </View>

          <View className="px-4 pt-4">
            <ThemedButton
              label={t('login.close')}
              variant="secondary"
              fullWidth
              disabled={busy}
              onPress={onClose}
            />
          </View>
        </KeyboardAwareScrollView>
      </View>
    </ModalSheet>
  );
}

function RecoveryOption({
  icon,
  title,
  subtitle,
  disabled,
  onPress,
}: {
  readonly icon: 'faceid' | 'icloud' | 'square.and.pencil';
  readonly title: string;
  readonly subtitle: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
}): ReactNode {
  return (
    <ThemedSurface variant="outlined" className="rounded-none p-1">
      <ThemedButton
        label={title}
        variant="secondary"
        fullWidth
        disabled={disabled}
        accessibilityHint={subtitle}
        leadingIcon={<SfIcon name={icon} size={18} color={Colors.primaryMauve} />}
        onPress={onPress}
      />
      <ThemedText variant="caption" tone="secondary" className="px-4 pb-3">
        {subtitle}
      </ThemedText>
    </ThemedSurface>
  );
}
