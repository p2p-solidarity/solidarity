import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CopyableAddress } from '@/components/common/CopyableAddress';
import { InfoButton } from '@/components/common/InfoSheet';
import { ModalSheet } from '@/components/common/ModalSheet';
import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { SettingsBackToolbar, SettingsScreenTitle } from '@/components/settings/SettingsBlocks';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { useWebEditing, WEB_EDITOR_URL } from '@/components/webEditing/useWebEditing';
import { webEditingViewModel } from '@/components/webEditing/webEditingViewModel';
import { useThemeColors } from '@/constants/useThemeColors';
import { fadeUpIn } from '@/feedback/motion';
import { passkeyProvider } from '@/identity/passkeyAaguid';
import { getPasskeyRegistry, type ListedPasskey } from '@/identity/passkeyRegistry';
import { getRootVaultSyncState } from '@/identity/rootVaultSyncState';
import { useTranslation } from '@/i18n';
import { safeBack } from '@/navigation/safeBack';

import { passkeysViewModel, type PasskeysState } from './passkeysViewModel';

export function PasskeysScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const web = useWebEditing();
  const [list, setList] = useState<PasskeysState>({ kind: 'loading' });
  const [selected, setSelected] = useState<ListedPasskey | null>(null);
  const [revision, setRevision] = useState(0);
  const busy = web.state.kind === 'ready' && web.state.busy !== null;
  const view = passkeysViewModel(list, busy);
  // The list and the web-editing block read the same binding; when that read
  // fails, one message and one Retry say it — not two stacked error cards.
  const loadFailed = list.kind === 'error' || (web.state.kind === 'error' && web.state.operation === 'load');

  useEffect(() => {
    if (web.state.kind === 'loading') {
      setList({ kind: 'loading' });
      setSelected(null);
      return;
    }
    if (!web.binding) {
      setList({ kind: 'error' });
      setSelected(null);
      return;
    }
    const rows = getPasskeyRegistry().list(web.binding, getRootVaultSyncState(web.binding) === 'connected');
    setList(rows.ok ? { kind: 'ready', rows: rows.value } : { kind: 'error' });
  }, [web.state, web.binding, revision]);

  const rowTitle = (row: ListedPasskey) => 'legacy' in row ? t('passkeys.legacy') : row.device;
  const rowSubtitle = (row: ListedPasskey) => 'legacy' in row ? t('webEditing.connected') : [
    passkeyProvider(row.aaguid), new Date(row.createdAt).toLocaleDateString(),
  ].filter(Boolean).join(' · ');

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar title={t('settingsHub.title')} onPress={() => { safeBack('/settings'); }} />
      <View style={{ minHeight: 44, justifyContent: 'center' }}>
        <SettingsScreenTitle title={t('passkeys.title')} />
        <View style={{ position: 'absolute', right: 24, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
          <InfoButton title={t('passkeys.aboutTitle')} body={t('passkeys.aboutBody')} />
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 24 }}>
        <View style={{ gap: 12 }} accessibilityLiveRegion="polite">
          {list.kind === 'loading' ? <ActivityIndicator color={colors.text3} /> : null}
          {loadFailed ? <ThemedText variant="bodyMedium" tone="secondary">{t('passkeys.loadFailed')}</ThemedText>
            : view.messageKey ? <ThemedText variant="bodyMedium" tone="secondary">{t(view.messageKey)}</ThemedText> : null}
          {loadFailed ? (
            <ThemedButton label={t('webEditing.retry')} variant="secondary" fullWidth onPress={() => { void web.refresh(); }} />
          ) : null}
          {view.rows.length > 0 ? (
            <ThemedSurface variant="outlined">
              {view.rows.map((row, index) => {
                const pending = !('legacy' in row) && row.status === 'pending';
                return (
                  <Animated.View key={'legacy' in row ? 'legacy' : row.credentialId} entering={fadeUpIn(index, reduceMotion)}>
                    <PressableScale
                      accessibilityRole="button"
                      accessibilityLabel={`${rowTitle(row)}, ${rowSubtitle(row)}`}
                      onPress={() => { setSelected(row); }}
                      style={{ minHeight: 72, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                      <SfIcon name="key.fill" size={22} color={colors.text2} />
                      <View style={{ flex: 1, gap: 4 }}>
                        <ThemedText variant="bodyLarge">{rowTitle(row)}</ThemedText>
                        <ThemedText variant="caption" tone="secondary">{rowSubtitle(row)}</ThemedText>
                      </View>
                      <SfIcon name="chevron.right" size={12} color={colors.text3} />
                    </PressableScale>
                    {pending ? (
                      <View style={{ paddingHorizontal: 16, paddingBottom: 16, gap: 8 }}>
                        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                          <SfIcon name="exclamationmark.triangle" size={14} color={colors.destructive} />
                          <ThemedText variant="caption" tone="secondary">{t('passkeys.pending')}</ThemedText>
                        </View>
                        <ThemedButton label={t('webEditing.retry')} variant="secondary" disabled={busy} onPress={() => { void web.addPasskey(true); }} />
                      </View>
                    ) : null}
                  </Animated.View>
                );
              })}
            </ThemedSurface>
          ) : null}
          {loadFailed ? null : <ThemedButton
            label={t('passkeys.add')}
            variant="secondary"
            fullWidth
            disabled={!view.canAdd || web.state.kind !== 'ready'}
            loading={web.state.kind === 'ready' && web.state.busy === 'add'}
            onPress={() => { void web.addPasskey(); }}
          />}
        </View>
        {loadFailed ? null : <EditOnComputerBlock web={web} busy={busy} />}
      </ScrollView>
      <ModalSheet visible={selected !== null} presentationStyle="formSheet" onRequestClose={() => { setSelected(null); }}>
        {selected ? <PasskeyDetails title={rowTitle(selected)} subtitle={rowSubtitle(selected)} row={selected} busy={busy}
          onClose={() => { setSelected(null); }}
          onHide={() => {
            if (selected.binding !== web.binding || busy) return;
            const hidden = getPasskeyRegistry().hide(selected.binding, 'legacy' in selected ? null : selected.credentialId);
            setSelected(null);
            if (!hidden.ok) setList({ kind: 'error' });
            else setRevision(value => value + 1);
          }} /> : null}
      </ModalSheet>
    </View>
  );
}

function PasskeyDetails({ title, subtitle, row, busy, onHide, onClose }: {
  title: string; subtitle: string; row: ListedPasskey; busy: boolean; onHide: () => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-pageBg">
      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24, gap: 16 }}>
        <ThemedText variant="titleLarge">{title}</ThemedText>
        <ThemedText variant="bodyMedium" tone="secondary">{subtitle}</ThemedText>
        {!('legacy' in row) ? (
          <ThemedText variant="caption" tone="secondary">
            {[t(row.status === 'synced' ? 'webEditing.connected' : 'passkeys.pending'),
              row.attachment ? t(row.attachment === 'platform' ? 'passkeys.platform' : 'passkeys.crossPlatform') : null].filter(Boolean).join(' · ')}
          </ThemedText>
        ) : null}
        <ThemedText variant="bodyMedium" tone="secondary">{t('passkeys.revokeHint')}</ThemedText>
        <ThemedButton label={t('passkeys.hide')} variant="secondary" fullWidth disabled={busy} onPress={onHide} />
        <ThemedButton label={t('common.close')} variant="secondary" fullWidth onPress={onClose} />
      </ScrollView>
    </View>
  );
}

/** "Edit on your computer": the address to carry over, and one action. */
function EditOnComputerBlock({ web, busy }: { web: ReturnType<typeof useWebEditing>; busy: boolean }) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const view = webEditingViewModel(web.state);
  const connected = web.state.kind === 'ready' && web.state.connection === 'connected';
  const primary = view.primary && view.primary.action !== 'add' ? view.primary : null;
  return (
    <ThemedSurface variant="inset" padded>
      <View style={{ gap: 16 }} accessibilityLiveRegion="polite">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <SfIcon name="desktopcomputer" size={24} color={colors.text2} />
          <ThemedText variant="titleMedium" style={{ flex: 1 }}>{t('webEditing.title')}</ThemedText>
        </View>
        {web.state.kind === 'loading' ? <ActivityIndicator color={colors.text3} /> : null}
        {connected ? (
          <CopyableAddress address={WEB_EDITOR_URL} displayAddress="creds.id/edit"
            accessibilityLabel={t('webEditing.copyAddress', { url: 'creds.id/edit' })}
            copiedMessage={t('webEditing.addressCopied')} failedMessage={t('webEditing.addressCopyFailed')} />
        ) : <ThemedText variant="bodyMedium" tone="secondary">{t(view.copyKey)}</ThemedText>}
        {primary ? (
          <ThemedButton label={t(primary.labelKey)} fullWidth disabled={primary.disabled || busy}
            loading={web.state.kind === 'ready' && web.state.busy === 'open'}
            onPress={() => { void (primary.action === 'refresh' ? web.refresh() : web.openEditor()); }} />
        ) : null}
      </View>
    </ThemedSurface>
  );
}
