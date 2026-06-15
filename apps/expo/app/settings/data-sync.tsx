/**
 * Data & Sync settings — 1:1 port of
 * solidarity/Views/SettingsViews/DataSyncSettingsView.swift.
 *
 * Sections (top → bottom, conditional on developer mode):
 *   1. Sync & Backup — link to iCloud Backup & Restore (showing On/Off),
 *      plus an info row with the local credential count.
 *   2. Identity Key Recovery (dev only) — destructive
 *      "Reset Identity Keys (Local-Only)" row that drops every keychain
 *      entry and switches the master alias to local-only.
 *   3. Import / Export — link to VC Management (W3C VCs) and a button to
 *      export the verified social graph as JSON.
 *
 * TODO(android): the Swift original sweeps four keychain aliases and
 * toggles iCloud-sync vs local-only via UserDefaults. The Expo port
 * resets the signing key + regenerates it; if the user later moves to
 * a CKContainer/Drive-backed identity sync, the equivalent local-only
 * toggle ships in the same PR as the sync layer.
 *
 * TODO(android): graph export currently routes through a TODO toast.
 * `SocialGraphExportService` lives on Swift only; the JSON shape is
 * already defined in @solidarity/shared and the exporter ships next
 * iteration alongside the contact-graph sync.
 */
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  SettingsBackToolbar,
  SettingsBlockDangerRow,
  SettingsBlockInfoRow,
  SettingsBlockRow,
  SettingsBlockSection,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { useCredentialStore } from '@/credentials/store';
import { appAlert, showError } from '@/feedback/appAlert';
import { confirmDialog } from '@/feedback/confirmDialog';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import {
  ensureSigningKey,
  requireBiometric,
  resetSigningKeyForTesting,
} from '@/keychain';
import { usePreferences } from '@/settings/preferences';

export default function DataSyncSettings() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const developerMode = usePreferences((s) => s.developerMode);
  const backupEnabled = usePreferences((s) => s.backupEnabled);
  const policy = usePreferences((s) => s.biometricPolicy);
  const credentials = useCredentialStore((s) => s.manifest);
  const hydrateCreds = useCredentialStore((s) => s.hydrate);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void hydrateCreds();
  }, [hydrateCreds]);

  const onResetIdentityKeys = async () => {
    const ok = await confirmDialog({
      title: t('dataSync.resetKeys.confirmTitle'),
      message: t('dataSync.resetKeys.confirmMessage'),
      confirmLabel: t('dataSync.resetKeys.confirmAction'),
      destructive: true,
    });
    if (!ok) return;
    await resetIdentityKeys();
  };

  const resetIdentityKeys = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (policy.rotateMasterKey) {
        const ok = await requireBiometric('delete');
        if (!ok) {
          setBusy(false);
          return;
        }
      }
      await resetSigningKeyForTesting();
      await ensureSigningKey();
      appAlert({
        title: t('dataSync.resetKeys.doneTitle'),
        message: t('dataSync.resetKeys.doneMessage'),
      });
    } catch (err) {
      showError({
        context: 'Data & Sync › Reset Identity Keys',
        summary: t('dataSync.resetKeys.authFailed'),
        error: err,
      });
    } finally {
      setBusy(false);
    }
  };

  const onExportGraph = async () => {
    try {
      if (policy.exportGraph) {
        const ok = await requireBiometric('export');
        if (!ok) return;
      }
      // TODO(android): wire SocialGraphExportService analogue and
      // expo-sharing.shareAsync(uri) once the JSON exporter ships.
      pushToast(t('dataSync.exportGraph.todo'), 'info');
    } catch (err) {
      showError({
        context: 'Data & Sync › Export Graph',
        summary: t('dataSync.exportGraph.failed'),
        error: err,
      });
    }
  };

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar onPress={() => { router.back(); }} />
      <SettingsScreenTitle title={t('dataSync.title')} />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 24, paddingBottom: 24 + insets.bottom }}
      >
        <View className="gap-6">
          {/* Sync & Backup */}
          <SettingsBlockSection title={t('dataSync.section.syncBackup')}>
            <SettingsBlockRow
              icon="icloud"
              title={t('dataSync.icloudBackup')}
              trailingText={backupEnabled ? t('common.on') : t('common.off')}
              onPress={() => { router.push('/settings/backup'); }}
            />
            <SettingsBlockInfoRow
              icon="list.bullet.rectangle"
              title={t('dataSync.recordsInVault')}
              value={t('dataSync.cardsCount', { count: credentials.length })}
            />
          </SettingsBlockSection>

          {/* Identity Key Recovery (dev only) */}
          {developerMode ? (
            <SettingsBlockSection title={t('dataSync.section.keyRecovery')}>
              <SettingsBlockDangerRow
                icon="key.slash"
                title={t('dataSync.resetKeys.row')}
                subtitle={t('dataSync.resetKeys.subtitle')}
                onPress={() => { void onResetIdentityKeys(); }}
              />
            </SettingsBlockSection>
          ) : null}

          {/* Import / Export */}
          <SettingsBlockSection title={t('dataSync.section.importExport')}>
            <SettingsBlockRow
              icon="square.and.arrow.down"
              title={t('dataSync.importVc')}
              onPress={() => { router.push('/settings/vc'); }}
            />
            <SettingsBlockRow
              icon="square.and.arrow.up"
              title={t('dataSync.exportGraph')}
              showsChevron={false}
              onPress={() => { void onExportGraph(); }}
            />
          </SettingsBlockSection>
        </View>
      </ScrollView>
    </View>
  );
}
