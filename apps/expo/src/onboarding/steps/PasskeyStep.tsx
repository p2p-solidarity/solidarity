import { Platform, View } from 'react-native';
import { useState, type ReactNode } from 'react';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { appAlert, showError } from '@/feedback/appAlert';
import { haptic } from '@/feedback/haptics';
import { useTranslation } from '@/i18n';
import {
  createFromFreshMnemonic,
  enableICloudBackup,
  hasRootKey,
  restoreRootKeyFromICloud,
} from '@/identity';
import { readMnemonicForPasskeyConnection } from '@/identity/rootKey';
import { connectRootIdentityWithNativePasskey } from '@/identity/rootVaultSync';
import { setRootVaultSyncState } from '@/identity/rootVaultSyncState';
import { ensureSigningKey } from '@/keychain';
import { usePreferences } from '@/settings/preferences';

import {
  runOptionalPasskeySetup,
  type OptionalPasskeyChoice,
} from './optionalPasskeySetup';
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

  const completeIdentitySetup = async (
    choice: OptionalPasskeyChoice,
  ): Promise<void> => {
    if (working) return;
    setWorking(true);
    try {
      const outcome = await runOptionalPasskeySetup(choice, {
        prepareLocalIdentity: async () => {
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

          // Recovery remains mandatory identity setup; Web Passkey sync does not.
          if (Platform.OS === 'ios') {
            const backedUp = await enableICloudBackup();
            if (!backedUp.ok) throw new Error(backedUp.error.kind);
            setPref('rootKeySyncChoice', 'icloud');
          }

          await ensureSigningKey();
        },
        connectWeb: async () => {
          const mnemonic = await readMnemonicForPasskeyConnection();
          if (!mnemonic.ok) throw new Error(mnemonic.error.kind);
          return connectRootIdentityWithNativePasskey({
            mnemonic: mnemonic.value,
            userName: 'Solidarity',
          });
        },
      });

      if (outcome.kind === 'skipped') {
        setRootVaultSyncState('deferred');
        onCreated();
        return;
      }
      if (outcome.kind === 'failed') {
        setRootVaultSyncState('deferred');
        if (outcome.error.kind !== 'cancelled') {
          appAlert({
            title: t('rootVault.failed.title'),
            message: t('ob.passkey.connectLater'),
          });
        }
        onCreated();
        return;
      }
      setRootVaultSyncState('connected', outcome.binding);
      haptic('success');
      onCreated();
    } catch (error) {
      haptic('error');
      showError({
        context: 'Onboarding › Web Editing',
        summary: t('ob.passkey.setupFailed'),
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
      onBack={onBack}
      footer={
        <View style={{ gap: 10 }}>
          <ThemedButton
            label={working ? t('ob.passkey.working') : t('ob.passkey.btn')}
            variant="primary"
            fullWidth
            loading={working}
            onPress={() => {
              void completeIdentitySetup('connect');
            }}
          />
          <ThemedButton
            label={t('ob.passkey.later')}
            variant="secondary"
            fullWidth
            disabled={working}
            onPress={() => {
              void completeIdentitySetup('skip');
            }}
          />
        </View>
      }>
      {/* Picture, not paragraph: this phone → a passkey → your computer. The
          title says what it is and "Not Now" says it is optional; the one
          caption is where the recovery copy lives, because that happens
          whichever button is pressed. */}
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24 }}>
        <PhoneToComputerGlyph />
        <ThemedText variant="caption" tone="tertiary" style={{ textAlign: 'center' }}>
          {t(Platform.OS === 'ios' ? 'ob.passkey.backup.ios' : 'ob.passkey.backup.device')}
        </ThemedText>
      </View>
    </V2OnboardingScaffold>
  );
}

/** Decorative: phone ··· key ··· computer. Hidden from screen readers — the
 *  title carries the meaning. */
function PhoneToComputerGlyph(): ReactNode {
  const dots = (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: Colors.text3 }}
        />
      ))}
    </View>
  );
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <ThemedSurface
        variant="elevated"
        className="h-20 w-20 items-center justify-center rounded-full">
        <SfIcon name="iphone" size={34} color={Colors.text2} />
      </ThemedSurface>
      {dots}
      <SfIcon name="key.fill" size={18} color={Colors.primaryMauve} />
      {dots}
      <ThemedSurface
        variant="elevated"
        className="h-28 w-28 items-center justify-center rounded-full">
        <SfIcon name="desktopcomputer" size={52} color={Colors.primaryMauve} />
      </ThemedSurface>
    </View>
  );
}
