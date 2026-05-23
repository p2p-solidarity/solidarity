/**
 * Me tab — 1:1 port of solidarity/Views/MeViews/MeTabView.swift.
 *
 * Layout (top → bottom):
 *   1. NavigationStack — nav title "Me" (inline) + trailing gearshape
 *   2. ProfileHeaderCard (avatar 56pt + name 24pt + DID pill + Edit)
 *   3. "Verified Credentials" section
 *        empty:  3 MeActionTile (Scan Identity / Manual Input / Import JSON)
 *        filled: VerifiedCredentialRow per credential
 *   4. "Selective Disclosures" section
 *        empty:  "No derivations available."
 *        filled: DisclosureRowView per claim
 *   5. "Action" section: tiles (Acquire New Proof / Import Raw Credential)
 *   6. "Developer" section (dev-mode only): ZK Identity / OIDC Request
 *      Scanner / Group Management
 *
 * All copy matches Swift verbatim. SF Symbols rendered via expo-symbols.
 */
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCardStore, useMyCard } from '@/cards/cardManager';
import { SfIcon } from '@/components/icons/SfIcon';
import {
  DisclosureRowView,
  MeActionTile,
  MeSectionHeader,
  ProfileHeaderCard,
  SettingsBlockRow,
  SettingsBlockSection,
  VerifiedCredentialRow,
} from '@/components/me';
import { Colors } from '@/constants/Colors';
import { useCredentialStore } from '@/credentials/store';
import { usePreferences } from '@/settings/preferences';

const FALLBACK_NAME = 'User Node';
const INIT_DID = 'Initializing...';

export default function MeTab() {
  const card = useMyCard();
  const credentials = useCredentialStore((s) => s.items);
  const hydrateCards = useCardStore((s) => s.hydrate);
  const hydrateCreds = useCredentialStore((s) => s.hydrate);
  const developerMode = usePreferences((s) => s.developerMode);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    void hydrateCards();
    void hydrateCreds();
  }, [hydrateCards, hydrateCreds]);

  const displayName = card?.name ?? FALLBACK_NAME;
  const displayDid = INIT_DID;

  // Swift filters out type === "business_card" — mirror that.
  const verifiedCreds = credentials.filter((c) => c.type !== 'business_card');

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <NavBar onSettings={() => router.push('/settings')} />

      <ScrollView contentContainerStyle={{ paddingTop: 12, paddingBottom: 100 }}>
        <View className="gap-8">
          <ProfileHeaderCard
            name={displayName}
            did={shortDid(displayDid)}
            avatar={<InitialAvatar name={displayName} />}
            onEdit={() => router.push(card ? { pathname: '/cards/edit', params: { id: card.id } } : '/cards/edit')}
          />

          <VerifiedCredentialsSection
            items={verifiedCreds}
            onScanIdentity={() => router.push('/passport')}
            onManualInput={() => router.push({ pathname: '/passport', params: { manual: '1' } })}
            onImportJson={() => router.push('/credentials')}
          />

          <SelectiveDisclosuresSection />

          <ActionSection
            onAcquire={() => router.push('/passport')}
            onImportRaw={() => router.push('/credentials')}
          />

          {developerMode ? (
            <DeveloperSection
              onZk={() => router.push({ pathname: '/settings', params: { section: 'zk' } })}
              onOidc={() => router.push({ pathname: '/settings', params: { section: 'oidc' } })}
              onGroups={() => router.push('/groups')}
            />
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

function NavBar({ onSettings }: { onSettings: () => void }) {
  return (
    <View
      className="flex-row items-center justify-between px-4"
      style={{ height: 44 }}
    >
      <View style={{ width: 44 }} />
      <Text className="text-text1 text-[17px] font-semibold">Me</Text>
      <Pressable
        onPress={onSettings}
        accessibilityRole="button"
        style={{ width: 44, height: 44, alignItems: 'flex-end', justifyContent: 'center' }}
        className="active:opacity-60"
      >
        <SfIcon name="gearshape" size={18} color={Colors.text1} />
      </Pressable>
    </View>
  );
}

function VerifiedCredentialsSection({
  items,
  onScanIdentity,
  onManualInput,
  onImportJson,
}: {
  items: ReadonlyArray<{
    id: string;
    type: string;
    title: string;
    trustLevel: 'L1' | 'L2' | 'L3';
    issuerDid: string;
  }>;
  onScanIdentity: () => void;
  onManualInput: () => void;
  onImportJson: () => void;
}) {
  return (
    <View className="gap-2">
      <MeSectionHeader title="Verified Credentials" />
      {items.length === 0 ? (
        <View className="px-4 gap-2">
          <View className="flex-row gap-2">
            <MeActionTile icon="viewfinder" title="Scan Identity" onPress={onScanIdentity} />
            <MeActionTile icon="keyboard" title="Manual Input" onPress={onManualInput} />
          </View>
          <MeActionTile
            icon="square.and.arrow.up"
            title="Import JSON"
            onPress={onImportJson}
          />
        </View>
      ) : (
        <View className="gap-2">
          {items.map((c) => (
            <VerifiedCredentialRow
              key={c.id}
              icon={credentialIcon(c.type)}
              title={c.title}
              trustLevel={mapTrustLevel(c.trustLevel)}
              issuerType={c.issuerDid.startsWith('did:') ? (c.issuerDid.split(':')[1] ?? 'unknown') : 'unknown'}
              onPress={() => router.push({ pathname: '/credentials/[id]', params: { id: c.id } })}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function SelectiveDisclosuresSection() {
  return (
    <View className="gap-2">
      <MeSectionHeader title="Selective Disclosures" />
      <View className="px-4">
        <Text className="text-text3 text-[13px]">
          No derivations available.
        </Text>
      </View>
    </View>
  );
}

function ActionSection({
  onAcquire,
  onImportRaw,
}: {
  onAcquire: () => void;
  onImportRaw: () => void;
}) {
  return (
    <View className="gap-2">
      <MeSectionHeader title="Action" />
      <View className="px-4 flex-row gap-2">
        <MeActionTile icon="plus" title="Acquire New Proof" onPress={onAcquire} />
        <MeActionTile
          icon="square.and.arrow.up"
          title="Import Raw Credential"
          onPress={onImportRaw}
        />
      </View>
    </View>
  );
}

function DeveloperSection({
  onZk,
  onOidc,
  onGroups,
}: {
  onZk: () => void;
  onOidc: () => void;
  onGroups: () => void;
}) {
  return (
    <SettingsBlockSection title="Developer">
      <SettingsBlockRow
        icon="shield"
        title="ZK Identity"
        trailingText="Not initialized"
        onPress={onZk}
      />
      <SettingsBlockRow
        icon="qrcode"
        title="OIDC Request Scanner"
        onPress={onOidc}
      />
      <SettingsBlockRow
        icon="person.2"
        title="Group Management"
        trailingText="0 Groups"
        onPress={onGroups}
        isLast
      />
    </SettingsBlockSection>
  );
}

function InitialAvatar({ name }: { name: string }) {
  const initial = (name.trim().charAt(0) || '?').toUpperCase();
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: `${Colors.primaryBlue}2E`,
      }}
    >
      <Text
        style={{ color: Colors.primaryBlue }}
        className="text-[22px] font-bold"
      >
        {initial}
      </Text>
    </View>
  );
}

function shortDid(did: string): string {
  if (did.length <= 22) return did;
  return `${did.slice(0, 12)}...${did.slice(-8)}`;
}

function credentialIcon(type: string): import('expo-symbols').SFSymbol {
  switch (type) {
    case 'passport': return 'doc.text.fill';
    case 'student': return 'graduationcap.fill';
    case 'social_graph':
    case 'socialGraph':
      return 'person.2.fill';
    default: return 'checkmark.shield.fill';
  }
}

function mapTrustLevel(t: 'L1' | 'L2' | 'L3'): 'green' | 'blue' | 'other' {
  switch (t) {
    case 'L3': return 'green';
    case 'L2': return 'blue';
    default:   return 'other';
  }
}
