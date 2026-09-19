/**
 * VC Management — port of solidarity/Views/SettingsViews/VCSettingsView.swift.
 *
 * Layout (Swift parity):
 *   • Navigation title "VC Management" (inline)
 *   • Section "About" with footer "Manage your Verifiable Credentials (VCs) for did:key."
 *   • Section "Actions" with 4 rows: Create did:key VC, Receive Card (OIDC),
 *     Export VCs, Import VCs.
 *   • Then below: list of stored VCs as VerifiedCredentialRow cards (mirrors
 *     Me-tab visual style).
 *
 * did:key creation is wired through the shared self-issued
 * BusinessCardCredential service. OIDC receive, JSON export, and JSON import
 * share the same flows as Settings › VC Management.
 */
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import type { SFSymbol } from 'expo-symbols';
import { Redirect, router } from 'expo-router';
import { safeBack } from '@/navigation/safeBack';
import * as Sharing from 'expo-sharing';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IssuerBadge } from '@/components/credentials/IssuerBadge';
import { PublicDisclosureAction } from '@/components/credentials/PublicDisclosureAction';
import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { VerifiedCredentialRow } from '@/components/me';
import { ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useCardStore } from '@/cards/cardManager';
import { createDidKeyBusinessCardCredential } from '@/credentials/didKeyCredential';
import type { CredentialManifestEntry } from '@/credentials/credentialManifest';
import { useIssuerMetadataStore } from '@/credentials/issuerStore';
import { useCredentialStore } from '@/credentials/store';
import { credentialTrustDisplayFor } from '@/credentials/trustDisplay';
import {
  buildVcExportText,
  importCredentialJwts,
  parseVcExportText,
  VC_EXPORT_FILENAME,
} from '@/credentials/vcImportExport';
import { appAlert, showError } from '@/feedback/appAlert';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { requireSensitiveAction } from '@/keychain';
import { usePreferences } from '@/settings/preferences';

interface ActionRowProps {
  readonly icon: SFSymbol;
  readonly title: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
}

function ActionRow({ icon, title, onPress, disabled = false }: ActionRowProps) {
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}>
      <ThemedSurface
        variant="inset"
        className="flex-row items-center gap-3 rounded-none px-[14px] py-[14px]"
        style={{ opacity: disabled ? 0.5 : 1 }}>
        <View style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}>
          <SfIcon name={icon} size={14} color={Colors.text1} />
        </View>
        <ThemedText variant="bodyMedium" style={{ flex: 1 }}>
          {title}
        </ThemedText>
        <SfIcon name="chevron.right" size={12} weight="semibold" color={Colors.text3} />
      </ThemedSurface>
    </PressableScale>
  );
}

function SectionHeader({ title }: { readonly title: string }) {
  return (
    <View className="px-4">
      <ThemedText variant="label">{title}</ThemedText>
    </View>
  );
}

function SectionFooter({ text }: { readonly text: string }) {
  return (
    <View className="px-4">
      <ThemedText variant="caption" tone="tertiary">
        {text}
      </ThemedText>
    </View>
  );
}

function iconFor(item: CredentialManifestEntry): SFSymbol {
  switch (item.type) {
    case 'passport':
      return 'doc.text.fill';
    case 'student':
      return 'graduationcap.fill';
    case 'social_graph':
    case 'socialGraph':
      return 'person.2.fill';
    default:
      return 'checkmark.shield.fill';
  }
}

export default function VCManagementRoute() {
  const developerMode = usePreferences((state) => state.developerMode);
  if (!developerMode) return <Redirect href="/settings" />;

  return <VCManagementScreen />;
}

function VCManagementScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const manifest = useCredentialStore((s) => s.manifest);
  const details = useCredentialStore((s) => s.details);
  const hydrate = useCredentialStore((s) => s.hydrate);
  const hydrateIssuers = useIssuerMetadataStore((s) => s.hydrate);
  const hydrateCards = useCardStore((s) => s.hydrate);
  const loadCardDetail = useCardStore((s) => s.loadDetail);
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
    void hydrateIssuers();
    void hydrateCards();
  }, [hydrate, hydrateCards, hydrateIssuers]);

  const onBack = () => {
    safeBack();
  };

  const onCreateDidKey = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await hydrateCards();
      const cardState = useCardStore.getState();
      const first = cardState.manifest[0];
      const card = first
        ? (cardState.details.get(first.id) ?? (await loadCardDetail(first.id)))
        : null;
      if (!card) {
        appAlert({ title: t('vcManage.title'), message: t('vc.createDidKey.noCard') });
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
        context: 'Credentials › Create did:key VC',
        summary: t('vc.createDidKey.failed'),
        error: err,
      });
    } finally {
      setBusy(false);
    }
  };

  const onReceiveOidc = () => {
    router.push('/scan');
  };

  const onExport = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await hydrate();
      const fresh = Array.from(useCredentialStore.getState().details.values());
      if (fresh.length === 0) {
        appAlert({ title: t('vcManage.title'), message: t('vcManage.noneToExport') });
        return;
      }
      const gate = await requireSensitiveAction(
        'exportGraph',
        t('security.prompt.exportGraph')
      );
      if (!gate.success) {
        setBusy(false);
        return;
      }
      const cache = FileSystem.cacheDirectory ?? '';
      if (!cache) throw new Error('Cache directory unavailable.');
      const fileUri = `${cache}${VC_EXPORT_FILENAME}`;
      await FileSystem.writeAsStringAsync(
        fileUri,
        buildVcExportText(fresh.map((credential) => credential.rawJwt)),
        { encoding: FileSystem.EncodingType.UTF8 }
      );
      if (!(await Sharing.isAvailableAsync())) {
        appAlert({ title: t('vcManage.title'), message: t('vc.savedTo', { uri: fileUri }) });
        return;
      }
      await Sharing.shareAsync(fileUri, {
        mimeType: 'application/json',
        dialogTitle: 'Export Verifiable Credentials',
      });
    } catch (err) {
      showError({ context: 'Credentials › Export', summary: t('vc.exportFailed'), error: err });
    } finally {
      setBusy(false);
    }
  };

  const onImport = async () => {
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
      if (jwts.length === 0) {
        appAlert({ title: t('vcManage.title'), message: t('vc.noneInFile') });
        return;
      }
      await hydrate();
      const state = useCredentialStore.getState();
      const result = await importCredentialJwts(jwts, {
        existingIds: [...state.manifest.map((entry) => entry.id), ...state.details.keys()],
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
          appAlert({ title: t('vcManage.title'), message: t('vc.noneNewInFile') });
        }
        return;
      }
      pushToast(t('vc.importSuccess', { count: result.imported }), 'success');
    } catch (err) {
      showError({ context: 'Credentials › Import', summary: t('vc.readFailed'), error: err });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="flex-1 bg-pageBg">
      {/* Navigation bar — chevron.left + inline title (Swift parity) */}
      <View style={{ paddingTop: insets.top }} className="bg-pageBg">
        <View className="h-11 flex-row items-center px-4">
          <PressableScale
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel={t('vcManage.back')}
            className="-ml-1 flex-row items-center gap-1"
            style={{ width: 44, height: 44 }}>
            <SfIcon name="chevron.left" size={16} weight="semibold" color={Colors.text1} />
          </PressableScale>
          <View className="flex-1 items-center">
            <ThemedText variant="titleMedium">{t('vcManage.title')}</ThemedText>
          </View>
          <View style={{ width: 24 }} />
        </View>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingVertical: 24 }}>
        <View className="gap-2">
          <SectionHeader title={t('vcManage.aboutHeader')} />
          <SectionFooter text={t('vcManage.aboutFooter')} />
        </View>

        <View className="h-6" />

        <View className="gap-2">
          <SectionHeader title={t('vcManage.actionsHeader')} />
          <View className="gap-2 px-4">
            <ActionRow
              icon="key.fill"
              title={t('vcManage.createDidKey')}
              disabled={busy}
              onPress={() => {
                void onCreateDidKey();
              }}
            />
            <ActionRow
              icon="qrcode"
              title={t('vcManage.receiveCard')}
              disabled={busy}
              onPress={onReceiveOidc}
            />
            <ActionRow
              icon="square.and.arrow.up"
              title={t('vcManage.exportVcs')}
              disabled={busy}
              onPress={() => {
                void onExport();
              }}
            />
            <ActionRow
              icon="square.and.arrow.down"
              title={t('vcManage.importVcs')}
              disabled={busy}
              onPress={() => {
                void onImport();
              }}
            />
          </View>
        </View>

        <View className="mt-6 px-4">
          <PublicDisclosureAction />
        </View>

        {manifest.length > 0 ? (
          <View className="mt-6 gap-2">
            <SectionHeader title={t('vcManage.storedHeader')} />
            <View className="gap-3">
              {manifest.map((item) => {
                // `issuerDid` lives in the encrypted record. Once
                // `hydrate()` resolves, `details.get(id)` returns the
                // full credential and the badge renders the real issuer.
                // Until then the badge falls back to "—" rather than
                // leaking did from the manifest sidecar.
                const detail = details.get(item.id);
                const issuerId = detail?.issuerDid ?? '';
                const trustDisplay = credentialTrustDisplayFor(detail ?? item);
                return (
                  <View key={item.id} className="gap-1">
                    <VerifiedCredentialRow
                      icon={iconFor(item)}
                      title={item.title}
                      trustLevel={trustDisplay.level}
                      issuerType={item.type}
                      onPress={() => {
                        router.push({ pathname: '/credentials/[id]', params: { id: item.id } });
                      }}
                    />
                    {issuerId ? (
                      <View className="px-4">
                        <IssuerBadge issuerId={issuerId} fallbackName={issuerId} compact />
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </View>
        ) : (
          <View className="mt-6 gap-2">
            <SectionHeader title={t('vcManage.storedHeader')} />
            <SectionFooter text={t('vcManage.storedEmpty')} />
          </View>
        )}

        <View className="h-8" />
      </ScrollView>
    </View>
  );
}
