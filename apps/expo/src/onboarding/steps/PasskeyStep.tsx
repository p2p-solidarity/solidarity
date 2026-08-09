import { Platform, View } from 'react-native';
import { useState, type ReactNode } from 'react';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { showError } from '@/feedback/appAlert';
import { haptic } from '@/feedback/haptics';
import { useTranslation } from '@/i18n';
import {
  createFromFreshMnemonic,
  enableICloudBackup,
  hasRootKey,
  restoreRootKeyFromICloud,
} from '@/identity';
import { ensureSigningKey } from '@/keychain';
import { usePreferences } from '@/settings/preferences';

import { V2OnboardingScaffold } from './V2OnboardingScaffold';

export function PasskeyStep({
  onBack,
  onCreated,
}: {
  readonly onBack: () => void;
  readonly onCreated: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const setPref = usePreferences((state) => state.set);
  const [working, setWorking] = useState(false);

  const createPasskey = async (): Promise<void> => {
    if (working) return;
    setWorking(true);
    try {
      let rootExists = await hasRootKey();
      if (!rootExists && Platform.OS === 'ios') {
        const restored = await restoreRootKeyFromICloud();
        if (!restored.ok) throw new Error(restored.error.kind);
        rootExists = restored.value.kind !== 'notFound';
      }

      if (!rootExists) {
        const created = await createFromFreshMnemonic();
        if (!created.ok) throw new Error(created.error.kind);
      }

      // iOS gets a confirmed synchronizable recovery copy before this step
      // can say it is backed up. Android copy stays deliberately narrower.
      if (Platform.OS === 'ios') {
        const backedUp = await enableICloudBackup();
        if (!backedUp.ok) throw new Error(backedUp.error.kind);
        setPref('rootKeySyncChoice', 'icloud');
      }

      await ensureSigningKey();
      haptic('success');
      onCreated();
    } catch (error) {
      haptic('error');
      showError({
        context: 'Onboarding › Passkey',
        summary: t('ob.passkey.failed'),
        error,
      });
    } finally {
      setWorking(false);
    }
  };

  return (
    <V2OnboardingScaffold
      stepIndex={2}
      title={t('ob.passkey.title')}
      subtitle={t('ob.passkey.sub')}
      onBack={onBack}
      footer={
        <ThemedButton
          label={working ? t('ob.passkey.working') : t('ob.passkey.btn')}
          variant="primary"
          fullWidth
          loading={working}
          onPress={() => {
            void createPasskey();
          }}
        />
      }>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18 }}>
        <ThemedSurface
          variant="elevated"
          className="h-32 w-32 items-center justify-center rounded-full">
          <SfIcon name="faceid" size={64} color={Colors.primaryMauve} />
        </ThemedSurface>
        <ThemedText variant="label" tone="secondary">
          {t('ob.passkey.cap')}
        </ThemedText>
        <ThemedText variant="caption" tone="tertiary" style={{ textAlign: 'center' }}>
          {t(Platform.OS === 'ios' ? 'ob.passkey.backup.ios' : 'ob.passkey.backup.device')}
        </ThemedText>
      </View>
    </V2OnboardingScaffold>
  );
}
