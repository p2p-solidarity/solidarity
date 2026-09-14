import { useEffect, type ReactNode } from 'react';

import { appAlert } from '@/feedback/appAlert';
import { haptic } from '@/feedback/haptics';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { hasRootKey } from '@/identity/rootKey';
import {
  connectStoredRootIdentityWithNativePasskey,
  getStoredRootVaultIdentityBinding,
} from '@/identity/rootVaultSync';
import {
  getRootVaultSyncState,
  setRootVaultSyncState,
} from '@/identity/rootVaultSyncState';

let promptShownThisLaunch = false;

/** One-time existing-user offer on the first Page visit. */
export function RootVaultConnectPrompt(): ReactNode {
  const { t } = useTranslation();

  useEffect(() => {
    if (promptShownThisLaunch) return;
    const lifecycle = { active: true };
    void (async () => {
      const binding = await getStoredRootVaultIdentityBinding();
      if (
        !(await hasRootKey()) ||
        !lifecycle.active ||
        getRootVaultSyncState(binding ?? undefined) !== 'unknown'
      ) return;
      promptShownThisLaunch = true;
      appAlert({
        title: t('rootVault.prompt.title'),
        message: t('rootVault.prompt.body'),
        buttons: [
          {
            label: t('rootVault.prompt.connect'),
            onPress: () => {
              void (async () => {
                const result = await connectStoredRootIdentityWithNativePasskey();
                if (result.ok) {
                  setRootVaultSyncState('connected', result.value);
                  haptic('success');
                  pushToast(t('rootVault.connected'), 'success');
                  return;
                }
                if (result.error.kind === 'cancelled') {
                  setRootVaultSyncState('deferred');
                  return;
                }
                haptic('warning');
                appAlert({
                  title: t('rootVault.failed.title'),
                  message: t('rootVault.failed.body'),
                });
              })();
            },
          },
          {
            label: t('rootVault.prompt.later'),
            style: 'cancel',
            onPress: () => {
              setRootVaultSyncState('deferred');
            },
          },
        ],
      });
    })();
    return () => {
      lifecycle.active = false;
    };
  }, [t]);

  return null;
}
