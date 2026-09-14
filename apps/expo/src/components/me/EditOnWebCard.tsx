import { useEffect, useState, type ReactNode } from 'react';
import { Linking, View } from 'react-native';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { appAlert } from '@/feedback/appAlert';
import { haptic } from '@/feedback/haptics';
import { useTranslation } from '@/i18n';
import {
  connectStoredRootIdentityWithNativePasskey,
  getStoredRootVaultIdentityBinding,
} from '@/identity/rootVaultSync';
import {
  getRootVaultSyncState,
  setRootVaultSyncState,
} from '@/identity/rootVaultSyncState';

const WEB_EDITOR_URL = 'https://creds.id/edit';

export interface EditOnWebCardProps {
  /** Kept so the Page model still controls whether public content exists. */
  readonly url: string | null;
}

/** One button: connect once if needed, then open the browser editor. */
export function EditOnWebCard({ url }: EditOnWebCardProps): ReactNode {
  const { t } = useTranslation();
  const [state, setState] = useState<'unknown' | 'connected' | 'deferred'>('unknown');
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let active = true;
    void getStoredRootVaultIdentityBinding().then((binding) => {
      if (active) setState(getRootVaultSyncState(binding ?? undefined));
    });
    return () => {
      active = false;
    };
  }, []);

  const connect = async (openAfter: boolean): Promise<void> => {
    if (working) return;
    setWorking(true);
    try {
      const connected = await connectStoredRootIdentityWithNativePasskey();
      if (!connected.ok) {
        if (connected.error.kind !== 'cancelled') {
          appAlert({
            title: t('rootVault.failed.title'),
            message: t('rootVault.failed.body'),
          });
        }
        return;
      }
      setRootVaultSyncState('connected', connected.value);
      setState('connected');
      haptic('success');
      if (openAfter) await Linking.openURL(WEB_EDITOR_URL);
    } catch {
      appAlert({
        title: t('rootVault.failed.title'),
        message: t('rootVault.failed.body'),
      });
    } finally {
      setWorking(false);
    }
  };

  const open = async (): Promise<void> => {
    if (working) return;
    const binding = await getStoredRootVaultIdentityBinding();
    if (getRootVaultSyncState(binding ?? undefined) !== 'connected') {
      await connect(true);
      return;
    }
    await Linking.openURL(WEB_EDITOR_URL);
  };

  return (
    <View className="px-4">
      <ThemedSurface variant="card" padded style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <SfIcon name="desktopcomputer" size={16} color={Colors.text1} />
          <ThemedText variant="label">{t('mePage.editOnWeb.title')}</ThemedText>
        </View>
        <ThemedText variant="bodySmall" tone="secondary">
          {state === 'connected'
            ? t('mePage.editOnWeb.connectedBody')
            : t('mePage.editOnWeb.connectBody')}
        </ThemedText>
        {url === null ? null : (
          <ThemedText variant="caption" tone="tertiary" numberOfLines={1}>
            {t('mePage.editOnWeb.publicReady')}
          </ThemedText>
        )}
        <ThemedButton
          label={
            working
              ? t('mePage.editOnWeb.connecting')
              : state === 'connected'
                ? t('mePage.editOnWeb.open')
                : t('mePage.editOnWeb.connect')
          }
          fullWidth
          loading={working}
          leadingIcon={
            <SfIcon
              name={state === 'connected' ? 'arrow.up.right' : 'faceid'}
              size={15}
              color={Colors.pageBg}
            />
          }
          onPress={() => {
            void open();
          }}
        />
        {state === 'connected' ? (
          <ThemedButton
            label={t('mePage.editOnWeb.reconnect')}
            variant="secondary"
            fullWidth
            disabled={working}
            onPress={() => {
              void connect(false);
            }}
          />
        ) : null}
      </ThemedSurface>
    </View>
  );
}
