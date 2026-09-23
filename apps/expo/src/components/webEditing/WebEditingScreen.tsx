import { useEffect, useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CopyableAddress } from '@/components/common/CopyableAddress';
import { ModalSheet } from '@/components/common/ModalSheet';
import { PressableScale } from '@/components/common/PressableScale';
import {
  SettingsBackToolbar,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { useTranslation } from '@/i18n';
import { safeBack } from '@/navigation/safeBack';

import { useWebEditing, WEB_EDITOR_URL } from './useWebEditing';
import { webEditingViewModel } from './webEditingViewModel';

export function WebEditingScreen(): ReactNode {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { state, refresh, connect, reconnect, openEditor } = useWebEditing();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const view = webEditingViewModel(state);
  const connected = state.kind === 'ready' && state.connection === 'connected';
  const busy = state.kind === 'ready' && state.busy !== null;
  const canReconnect = connected || (state.kind === 'error' && state.operation === 'reconnect' && state.previous === 'connected');

  useEffect(() => {
    if (!canReconnect) setConfirmOpen(false);
  }, [canReconnect]);

  const act = (): void => {
    switch (view.primary?.action) {
      case 'refresh': void refresh(); break;
      case 'connect': void connect(); break;
      case 'open': void openEditor(); break;
      case 'reconnect': setConfirmOpen(true); break;
    }
  };

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar onPress={() => { safeBack('/settings'); }} />
      <SettingsScreenTitle title={t('webEditing.title')} />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ flexGrow: 1, padding: 16, paddingTop: 24, paddingBottom: insets.bottom + 32, gap: 24 }}>
        <View style={{ gap: 16 }} accessibilityLiveRegion="polite">
          {view.statusKey ? (
            <ThemedText variant="label" tone="secondary">{t(view.statusKey)}</ThemedText>
          ) : null}
          <ThemedText variant="bodyLarge">{t(view.copyKey)}</ThemedText>
          {connected ? (
            <CopyableAddress
              address={WEB_EDITOR_URL}
              displayAddress="creds.id/edit"
              accessibilityLabel={t('webEditing.copyAddress', { url: 'creds.id/edit' })}
              copiedMessage={t('webEditing.addressCopied')}
              failedMessage={t('webEditing.addressCopyFailed')}
            />
          ) : null}
          {view.primary && !confirmOpen ? (
            <ThemedButton
              label={t(view.primary.labelKey)}
              fullWidth
              disabled={view.primary.disabled}
              loading={busy}
              onPress={act}
            />
          ) : null}
          {connected ? (
            <>
              <ThemedText variant="caption" tone="secondary">{t('webEditing.openHint')}</ThemedText>
              <PressableScale
                onPress={() => { setConfirmOpen(true); }}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={t('webEditing.reconnect')}
                accessibilityState={{ disabled: busy }}
                style={{ minHeight: 44, justifyContent: 'center', opacity: busy ? 0.5 : 1 }}>
                <ThemedText variant="bodyMedium" tone="secondary">{t('webEditing.reconnect')}</ThemedText>
              </PressableScale>
            </>
          ) : null}
        </View>
        <View style={{ marginTop: 'auto' }}>
          <ThemedSurface variant="inset" padded>
            <ThemedText variant="caption" tone="secondary">{t('webEditing.privacy')}</ThemedText>
          </ThemedSurface>
        </View>
      </ScrollView>
      <ModalSheet visible={confirmOpen && canReconnect} onRequestClose={() => { setConfirmOpen(false); }}>
        <ReconnectConfirmation
          onCancel={() => { setConfirmOpen(false); }}
          onConfirm={() => {
            setConfirmOpen(false);
            void reconnect();
          }}
        />
      </ModalSheet>
    </View>
  );
}

function ReconnectConfirmation({ onCancel, onConfirm }: {
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: insets.bottom + 24, gap: 24 }}>
        <ThemedText variant="titleLarge">{t('webEditing.reconnectTitle')}</ThemedText>
        <ThemedText variant="bodyLarge">{t('webEditing.reconnectBody')}</ThemedText>
        <ThemedButton label={t('webEditing.reconnect')} fullWidth onPress={onConfirm} />
        <ThemedButton label={t('common.cancel')} variant="secondary" fullWidth onPress={onCancel} />
      </ScrollView>
    </View>
  );
}
