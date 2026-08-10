/**
 * VC Management — 1:1 port of
 * solidarity/Views/SettingsViews/VCSettingsView.swift.
 *
 * Sections (top → bottom):
 *   1. About — empty section with footer
 *      "Manage your Verifiable Credentials (VCs) for did:key."
 *   2. Actions:
 *      • Create did:key VC          (button row)
 *      • Receive Card (OIDC)        (link → /settings/oidc-request)
 *      • Export VCs                 (button row → expo-sharing)
 *      • Import VCs                 (button row → expo-document-picker)
 *
 * Wire format mirrors Swift `VCExportWrapper` ({ version: 1, vcs: [jwt] })
 * so a JSON exported from the iOS build imports cleanly on Android and
 * vice-versa.
 *
 * "Create did:key VC" uses the active hardware-backed did:key signer to
 * mint and persist a self-issued L1 BusinessCardCredential.
 */
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Redirect, router } from 'expo-router';
import { safeBack } from '@/navigation/safeBack';
import * as Sharing from 'expo-sharing';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  SettingsBackToolbar,
  SettingsBlockRow,
  SettingsBlockSection,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { useCardStore } from '@/cards/cardManager';
import { createDidKeyBusinessCardCredential } from '@/credentials/didKeyCredential';
import { useCredentialStore } from '@/credentials/store';
import {
  buildVcExportText,
  importCredentialJwts,
  parseVcExportText,
  VC_EXPORT_FILENAME,
} from '@/credentials/vcImportExport';
import { appAlert, showError } from '@/feedback/appAlert';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { requireBiometric } from '@/keychain';
import { usePreferences } from '@/settings/preferences';

export default function VcSettingsRoute() {
  const developerMode = usePreferences((state) => state.developerMode);
  if (!developerMode) return <Redirect href="/settings/advanced" />;

  return <VcSettings />;
}

function VcSettings() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const hydrate = useCredentialStore((s) => s.hydrate);
  const hydrateCards = useCardStore((s) => s.hydrate);
  const loadCardDetail = useCardStore((s) => s.loadDetail);
  const policy = usePreferences((s) => s.biometricPolicy);
  const shareTitle = usePreferences((s) => s.shareTitle);
  const shareCompany = usePreferences((s) => s.shareCompany);
  const shareEmail = usePreferences((s) => s.shareEmail);
  const sharePhone = usePreferences((s) => s.sharePhone);
  const shareProfileImage = usePreferences((s) => s.shareProfileImage);
  const shareSocialNetworks = usePreferences((s) => s.shareSocialNetworks);
  const shareSkills = usePreferences((s) => s.shareSkills);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void hydrate();
    void hydrateCards();
  }, [hydrate, hydrateCards]);

  const onCreateDidKeyVc = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await hydrateCards();
      const cardState = useCardStore.getState();
      const first = cardState.manifest[0];
      const card = first
        ? cardState.details.get(first.id) ?? await loadCardDetail(first.id)
        : null;
      if (!card) {
        appAlert({ title: t('vc.title'), message: t('vc.createDidKey.noCard') });
        return;
      }
      const stored = await createDidKeyBusinessCardCredential(card, {
        shareFieldPreferences: {
          shareTitle,
          shareCompany,
          shareEmail,
          sharePhone,
          shareProfileImage,
          shareSocialNetworks,
          shareSkills,
        },
      });
      pushToast(t('vc.createDidKey.success', { title: stored.title }), 'success');
    } catch (err) {
      showError({
        context: 'VC Management › Create did:key VC',
        summary: t('vc.createDidKey.failed'),
        error: err,
      });
    } finally {
      setBusy(false);
    }
  };

  const onExportVcs = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await hydrate();
      const fresh = Array.from(useCredentialStore.getState().details.values());
      if (fresh.length === 0) {
        appAlert({ title: t('vc.title'), message: t('vc.noneToExport') });
        return;
      }
      if (policy.exportGraph) {
        const ok = await requireBiometric('export');
        if (!ok) {
          setBusy(false);
          return;
        }
      }
      const text = buildVcExportText(fresh.map((c) => c.rawJwt));
      const cache = FileSystem.cacheDirectory ?? '';
      if (!cache) throw new Error('Cache directory unavailable.');
      const fileUri = `${cache}${VC_EXPORT_FILENAME}`;
      await FileSystem.writeAsStringAsync(fileUri, text, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      if (!(await Sharing.isAvailableAsync())) {
        appAlert({ title: t('vc.title'), message: t('vc.savedTo', { uri: fileUri }) });
        return;
      }
      await Sharing.shareAsync(fileUri, {
        mimeType: 'application/json',
        dialogTitle: 'Export Verifiable Credentials',
      });
    } catch (err) {
      showError({ context: 'VC Management › Export', summary: t('vc.exportFailed'), error: err });
    } finally {
      setBusy(false);
    }
  };

  const onImportVcs = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'public.json', 'text/json'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled) {
        setBusy(false);
        return;
      }
      const asset = res.assets[0];
      if (!asset) {
        setBusy(false);
        return;
      }
      const text = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      const jwts = parseVcExportText(text);
      const total = jwts.length;
      if (total === 0) {
        appAlert({ title: t('vc.title'), message: t('vc.noneInFile') });
        return;
      }
      await hydrate();
      const state = useCredentialStore.getState();
      const result = await importCredentialJwts(jwts, {
        existingIds: [
          ...state.manifest.map((entry) => entry.id),
          ...state.details.keys(),
        ],
        addCredential: state.add,
      });
      if (result.rejected > 0) {
        pushToast(t('vc.importRejected', { count: result.rejected }), 'warning');
      }
      if (result.unverified > 0) {
        pushToast(t('vc.importUnverified', { count: result.unverified }), 'warning');
      }
      if (result.imported === 0) {
        if (result.rejected === 0) {
          appAlert({ title: t('vc.title'), message: t('vc.noneNewInFile') });
        }
        return;
      }
      pushToast(t('vc.importSuccess', { count: result.imported }), 'success');
    } catch (err) {
      showError({ context: 'VC Management › Import', summary: t('vc.readFailed'), error: err });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar onPress={() => { safeBack('/settings'); }} />
      <SettingsScreenTitle title={t('vc.title')} />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 24, paddingBottom: 24 + insets.bottom }}
      >
        <View className="gap-6">
          {/* About — empty section with footer */}
          <SettingsBlockSection
            title={t('vc.section.about')}
            footer={t('vc.about.footer')}
          >
            {/* Swift EmptyView() — render nothing. */}
            <View />
          </SettingsBlockSection>

          {/* Actions */}
          <SettingsBlockSection title={t('vc.section.actions')}>
            <SettingsBlockRow
              icon="key.fill"
              title={t('vc.createDidKey')}
              showsChevron={false}
              disabled={busy}
              onPress={() => { void onCreateDidKeyVc(); }}
            />
            <SettingsBlockRow
              icon="qrcode"
              title={t('vc.receiveOidc')}
              onPress={() => { router.push('/settings/oidc-request'); }}
            />
            <SettingsBlockRow
              icon="square.and.arrow.up"
              title={t('vc.export')}
              showsChevron={false}
              disabled={busy}
              onPress={() => { void onExportVcs(); }}
            />
            <SettingsBlockRow
              icon="square.and.arrow.down"
              title={t('vc.import')}
              showsChevron={false}
              disabled={busy}
              onPress={() => { void onImportVcs(); }}
            />
          </SettingsBlockSection>
        </View>
      </ScrollView>
    </View>
  );
}
