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
 * TODO(android): Swift's `VCService.issueAndStoreBusinessCardCredential`
 * mints + verifies a self-issued L1 VC. The Expo signing-key path
 * (`ensureSigningKey` + `signJwt`) ships next iteration; until then the
 * "Create did:key VC" button toasts a friendly stub instead of writing a
 * malformed credential.
 */
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  SettingsBackToolbar,
  SettingsBlockRow,
  SettingsBlockSection,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { useCredentialStore } from '@/credentials/store';
import { pushToast } from '@/feedback/toast';
import { requireBiometric } from '@/keychain';
import { usePreferences } from '@/settings/preferences';

interface VcExportWrapper {
  readonly version: number;
  readonly vcs: readonly string[];
}

function isVcExportWrapper(value: unknown): value is VcExportWrapper {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { vcs?: unknown };
  return (
    Array.isArray(v.vcs) && v.vcs.every((s) => typeof s === 'string')
  );
}

const EXPORT_FILENAME = 'solidarity_vcs.json';

export default function VcSettings() {
  const insets = useSafeAreaInsets();
  const credentials = useCredentialStore((s) => s.manifest);
  const hydrate = useCredentialStore((s) => s.hydrate);
  const policy = usePreferences((s) => s.biometricPolicy);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const onCreateDidKeyVc = () => {
    // TODO(android): wire VCService.issueAndStoreBusinessCardCredential.
    // The signing flow needs `ensureSigningKey` + `signJwt` + a verifier
    // round-trip; deferred until the issuer service ports.
    pushToast('Create did:key VC lands next iteration', 'info');
  };

  const onExportVcs = async () => {
    if (busy) return;
    if (credentials.length === 0) {
      Alert.alert('VC Management', 'No VCs found to export.');
      return;
    }
    setBusy(true);
    try {
      if (policy.exportGraph) {
        const ok = await requireBiometric('export');
        if (!ok) {
          setBusy(false);
          return;
        }
      }
      // Export pulls raw JWTs from the encrypted detail map — `hydrate()`
      // guarantees every manifest entry has a corresponding detail record
      // before we serialise. Reading from `getState()` instead of the
      // captured `details` prop avoids a stale render closure.
      await hydrate();
      const fresh = useCredentialStore.getState().details;
      const wrapper: VcExportWrapper = {
        version: 1,
        vcs: Array.from(fresh.values()).map((c) => c.rawJwt),
      };
      const cache = FileSystem.cacheDirectory ?? '';
      if (!cache) throw new Error('Cache directory unavailable.');
      const fileUri = `${cache}${EXPORT_FILENAME}`;
      await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(wrapper, null, 2), {
        encoding: FileSystem.EncodingType.UTF8,
      });
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('VC Management', `Saved to ${fileUri}`);
        return;
      }
      await Sharing.shareAsync(fileUri, {
        mimeType: 'application/json',
        dialogTitle: 'Export Verifiable Credentials',
      });
    } catch (err) {
      Alert.alert('VC Management', (err as Error).message);
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
      const parsed: unknown = JSON.parse(text);
      if (!isVcExportWrapper(parsed)) {
        throw new Error('Invalid VC export file: missing `vcs` array.');
      }
      // TODO(android): wire VCService.importPresentedCredential to verify
      // each JWT, derive its credential subject, and call useCredentialStore.add.
      // Until the verifier ports we just count the JWTs.
      const total = parsed.vcs.length;
      if (total === 0) {
        Alert.alert('VC Management', 'No VCs found in the file.');
        return;
      }
      pushToast(
        `Found ${String(total)} VCs — verifier lands next iteration`,
        'info'
      );
    } catch (err) {
      Alert.alert('VC Management', `Failed to read file: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar onPress={() => { router.back(); }} />
      <SettingsScreenTitle title="VC Management" />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 24, paddingBottom: 24 + insets.bottom }}
      >
        <View className="gap-6">
          {/* About — empty section with footer */}
          <SettingsBlockSection
            title="About"
            footer="Manage your Verifiable Credentials (VCs) for did:key."
          >
            {/* Swift EmptyView() — render nothing. */}
            <View />
          </SettingsBlockSection>

          {/* Actions */}
          <SettingsBlockSection title="Actions">
            <SettingsBlockRow
              icon="key.fill"
              title="Create did:key VC"
              showsChevron={false}
              onPress={onCreateDidKeyVc}
            />
            <SettingsBlockRow
              icon="qrcode"
              title="Receive Card (OIDC)"
              onPress={() => { router.push('/settings/oidc-request'); }}
            />
            <SettingsBlockRow
              icon="square.and.arrow.up"
              title="Export VCs"
              showsChevron={false}
              disabled={busy}
              onPress={() => { void onExportVcs(); }}
            />
            <SettingsBlockRow
              icon="square.and.arrow.down"
              title="Import VCs"
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
