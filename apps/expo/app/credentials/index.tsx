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
 * Real did:key creation, OIDC inbound, JSON export, and JSON import are not
 * wired yet in Expo (no @solidarity DID/VC service ported). The Actions tap
 * to toasts that indicate "wires next iteration", matching the in-app dev
 * pattern from other half-ported flows.
 */
import type { SFSymbol } from 'expo-symbols';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IssuerBadge } from '@/components/credentials/IssuerBadge';
import { SfIcon } from '@/components/icons/SfIcon';
import { VerifiedCredentialRow } from '@/components/me';
import { Colors } from '@/constants/Colors';
import {
  useIssuerMetadataStore,
} from '@/credentials/issuerStore';
import { useCredentialStore, type StoredCredential } from '@/credentials/store';
import { pushToast } from '@/feedback/toast';

interface ActionRowProps {
  readonly icon: SFSymbol;
  readonly title: string;
  readonly onPress: () => void;
}

function ActionRow({ icon, title, onPress }: ActionRowProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      className="flex-row items-center gap-3 rounded-xl bg-mutedSurface px-[14px] py-[14px] active:opacity-80"
    >
      <View
        style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}
      >
        <SfIcon name={icon} size={14} color={Colors.text1} />
      </View>
      <Text className="text-text1 text-[15px] flex-1">{title}</Text>
      <SfIcon name="chevron.right" size={12} weight="semibold" color={Colors.text3} />
    </Pressable>
  );
}

function SectionHeader({ title }: { readonly title: string }) {
  return (
    <View className="px-4">
      <Text className="text-text1 text-[14px]">{title}</Text>
    </View>
  );
}

function SectionFooter({ text }: { readonly text: string }) {
  return (
    <View className="px-4">
      <Text className="text-text3 text-[12px]">{text}</Text>
    </View>
  );
}

function trustLevelFor(
  item: StoredCredential
): 'green' | 'blue' | 'other' {
  if (item.trustLevel === 'L3') return 'green';
  if (item.trustLevel === 'L2') return 'blue';
  return 'other';
}

function iconFor(item: StoredCredential): SFSymbol {
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

export default function VCManagementScreen() {
  const insets = useSafeAreaInsets();
  const items = useCredentialStore((s) => s.items);
  const hydrate = useCredentialStore((s) => s.hydrate);
  const hydrateIssuers = useIssuerMetadataStore((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
    void hydrateIssuers();
  }, [hydrate, hydrateIssuers]);

  const onBack = () => {
    router.back();
  };

  const onCreateDidKey = () => {
    pushToast('did:key VC creation lands next iteration', 'info');
  };

  const onReceiveOidc = () => {
    pushToast('OIDC inbound (Receive Card) lands next iteration', 'info');
  };

  const onExport = () => {
    if (items.length === 0) {
      pushToast('No VCs found to export.', 'warning');
      return;
    }
    pushToast('Export to JSON lands next iteration', 'info');
  };

  const onImport = () => {
    pushToast('Import from JSON lands next iteration', 'info');
  };

  return (
    <View className="flex-1 bg-pageBg">
      {/* Navigation bar — chevron.left + inline title (Swift parity) */}
      <View
        style={{ paddingTop: insets.top }}
        className="bg-pageBg"
      >
        <View className="h-11 flex-row items-center px-4">
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            className="flex-row items-center gap-1 -ml-1 px-1 py-1 active:opacity-60"
          >
            <SfIcon name="chevron.left" size={16} weight="semibold" color={Colors.text1} />
          </Pressable>
          <View className="flex-1 items-center">
            <Text className="text-text1 text-[17px] font-semibold">VC Management</Text>
          </View>
          <View style={{ width: 24 }} />
        </View>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingVertical: 24 }}>
        <View className="gap-2">
          <SectionHeader title="About" />
          <SectionFooter text="Manage your Verifiable Credentials (VCs) for did:key." />
        </View>

        <View className="h-6" />

        <View className="gap-2">
          <SectionHeader title="Actions" />
          <View className="px-4 gap-2">
            <ActionRow icon="key.fill" title="Create did:key VC" onPress={onCreateDidKey} />
            <ActionRow icon="qrcode" title="Receive Card (OIDC)" onPress={onReceiveOidc} />
            <ActionRow icon="square.and.arrow.up" title="Export VCs" onPress={onExport} />
            <ActionRow icon="square.and.arrow.down" title="Import VCs" onPress={onImport} />
          </View>
        </View>

        {items.length > 0 ? (
          <View className="gap-2 mt-6">
            <SectionHeader title="Stored credentials" />
            <View className="gap-3">
              {items.map((item) => (
                <View key={item.id} className="gap-1">
                  <VerifiedCredentialRow
                    icon={iconFor(item)}
                    title={item.title}
                    trustLevel={trustLevelFor(item)}
                    issuerType={item.type}
                    onPress={() => {
                      router.push({ pathname: '/credentials/[id]', params: { id: item.id } });
                    }}
                  />
                  <View className="px-4">
                    <IssuerBadge
                      issuerId={item.issuerDid}
                      fallbackName={item.issuerDid}
                      compact
                    />
                  </View>
                </View>
              ))}
            </View>
          </View>
        ) : (
          <View className="gap-2 mt-6">
            <SectionHeader title="Stored credentials" />
            <SectionFooter text="No credentials yet. Use Create did:key VC or Receive Card (OIDC) above." />
          </View>
        )}

        <View className="h-8" />
      </ScrollView>
    </View>
  );
}
