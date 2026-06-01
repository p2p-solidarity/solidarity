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
import { Image as ExpoImage } from 'expo-image';
import { router } from 'expo-router';
import type { SFSymbol } from 'expo-symbols';
import { useEffect, useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { animalImageSource } from '@/cards/animals';
import { useCardStore, useMyCard } from '@/cards/cardManager';
import { PressableScale } from '@/components/common/PressableScale';
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
import { useThemeColors } from '@/constants/useThemeColors';
import { useTranslation } from '@/i18n';
import { SCALE, STAGGER_MS } from '@/feedback/motion';
import {
  useActiveDid,
  useDisplayClaims,
  useIdentityCoordinator,
  useIdentityData,
  type IdentityCardEntity,
  type ProvableClaimEntity,
} from '@/identity';
import { usePreferences } from '@/settings/preferences';

export default function MeTab() {
  const { t } = useTranslation();
  const card = useMyCard();
  const identityCards = useIdentityData((s) => s.identityCards);
  const hydrateCards = useCardStore((s) => s.hydrate);
  const hydrateIdentity = useIdentityData((s) => s.hydrate);
  const seedKeychain = useIdentityCoordinator((s) => s.seedFromKeychain);
  const developerMode = usePreferences((s) => s.developerMode);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    void hydrateCards();
    void hydrateIdentity();
    void seedKeychain();
  }, [hydrateCards, hydrateIdentity, seedKeychain]);

  const displayName = card?.name ?? t('meTab.fallbackName');
  const activeDid = useActiveDid();
  const displayDid = activeDid ?? t('meTab.initializingDid');

  // Swift filters out type === "business_card" — mirror that. Memoised so
  // the derived array keeps a stable reference between renders when the
  // upstream `identityCards` slice hasn't changed.
  const verifiedCreds = useMemo(
    () => identityCards.filter((c) => c.type !== 'business_card'),
    [identityCards]
  );
  const disclosures = useDisplayClaims();

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <NavBar onSettings={() => router.push('/settings')} />

      <ScrollView contentContainerStyle={{ paddingTop: 12, paddingBottom: 100 }}>
        <View className="gap-8">
          {/* Sections assemble top-down on first paint — a subtle staggered
              drop-in. Tabs stay mounted (rule 10) so it plays once, not on
              every re-focus. */}
          <Animated.View entering={FadeInDown.duration(360)}>
            <ProfileHeaderCard
              name={displayName}
              did={shortDid(displayDid)}
              avatar={
                card?.animal ? (
                  <ExpoImage
                    source={animalImageSource(card.animal)}
                    style={{ width: 56, height: 56 }}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    recyclingKey={`animal-${card.animal}-me-header`}
                    transition={0}
                  />
                ) : (
                  <InitialAvatar name={displayName} />
                )
              }
              onEdit={() => router.push(card ? { pathname: '/cards/edit', params: { id: card.id } } : '/cards/edit')}
            />
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(360).delay(STAGGER_MS)}>
            <VerifiedCredentialsSection
              items={verifiedCreds}
              onScanIdentity={() => router.push('/passport')}
              onManualInput={() => router.push({ pathname: '/passport', params: { manual: '1' } })}
              onImportJson={() => router.push('/credentials')}
            />
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(360).delay(STAGGER_MS * 2)}>
            <SelectiveDisclosuresSection claims={disclosures} />
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(360).delay(STAGGER_MS * 3)}>
            <ActionSection
              onAcquire={() => router.push('/passport')}
              onImportRaw={() => router.push('/credentials')}
            />
          </Animated.View>

          {developerMode ? (
            <Animated.View entering={FadeInDown.duration(360).delay(STAGGER_MS * 4)}>
              <DeveloperSection
                onZk={() => router.push('/id/zk-settings')}
                onOidc={() => router.push('/settings/oidc-request')}
                onGroups={() => router.push('/settings/groups')}
              />
            </Animated.View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

function NavBar({ onSettings }: { onSettings: () => void }) {
  const c = useThemeColors();
  const { t } = useTranslation();
  return (
    <View
      className="flex-row items-center justify-between px-4"
      style={{ height: 44 }}
    >
      <View style={{ width: 44 }} />
      <Text className="text-text1 text-[17px] font-semibold">{t('tab.me')}</Text>
      <PressableScale
        haptic="tap"
        scaleTo={SCALE.icon}
        onPress={onSettings}
        accessibilityRole="button"
        accessibilityLabel={t('meTab.settings')}
        style={{ width: 44, height: 44, alignItems: 'flex-end', justifyContent: 'center' }}
      >
        <SfIcon name="gearshape" size={18} color={c.text1} />
      </PressableScale>
    </View>
  );
}

function VerifiedCredentialsSection({
  items,
  onScanIdentity,
  onManualInput,
  onImportJson,
}: {
  readonly items: readonly IdentityCardEntity[];
  readonly onScanIdentity: () => void;
  readonly onManualInput: () => void;
  readonly onImportJson: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View className="gap-2">
      <MeSectionHeader title={t('meTab.verifiedCredentials')} />
      {items.length === 0 ? (
        <View className="px-4 gap-2">
          <View className="flex-row gap-2">
            <MeActionTile icon="viewfinder" title={t('meTab.scanIdentity')} onPress={onScanIdentity} />
            <MeActionTile icon="keyboard" title={t('meTab.manualInput')} onPress={onManualInput} />
          </View>
          <MeActionTile
            icon="square.and.arrow.up"
            title={t('meTab.importJson')}
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

function SelectiveDisclosuresSection({
  claims,
}: {
  readonly claims: readonly ProvableClaimEntity[];
}) {
  const { t } = useTranslation();
  return (
    <View className="gap-2">
      <MeSectionHeader title={t('meTab.selectiveDisclosures')} />
      {claims.length === 0 ? (
        <View className="px-4">
          <Text className="text-text3 text-[13px]">
            {t('meTab.noDerivations')}
          </Text>
        </View>
      ) : (
        <View className="gap-2">
          {claims.map((c) => (
            <DisclosureRowView
              key={c.id}
              icon={claimIcon(c.claimType)}
              title={c.title}
              source={`Src:${capitalize(c.source)}`}
              actionTitle={t('meTab.show')}
              onPresent={() => {
                router.push({ pathname: '/credentials/[id]', params: { id: c.identityCardId } });
              }}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function claimIcon(claimType: string): SFSymbol {
  switch (claimType) {
    case 'is_human': return 'faceid';
    case 'age_over_18': return 'face.smiling';
    case 'profile_card': return 'person.crop.rectangle.fill';
    case 'field_name': return 'person.fill';
    default: return 'checkmark.shield.fill';
  }
}

function capitalize(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function ActionSection({
  onAcquire,
  onImportRaw,
}: {
  onAcquire: () => void;
  onImportRaw: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View className="gap-2">
      <MeSectionHeader title={t('meTab.action')} />
      <View className="px-4 flex-row gap-2">
        <MeActionTile icon="plus" title={t('meTab.acquireNewProof')} onPress={onAcquire} />
        <MeActionTile
          icon="square.and.arrow.up"
          title={t('meTab.importRawCredential')}
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
  const { t } = useTranslation();
  return (
    <SettingsBlockSection title={t('meTab.developer')}>
      <SettingsBlockRow
        icon="shield"
        title={t('meTab.zkIdentity')}
        trailingText={t('meTab.notInitialized')}
        onPress={onZk}
      />
      <SettingsBlockRow
        icon="qrcode"
        title={t('meTab.oidcRequestScanner')}
        onPress={onOidc}
      />
      <SettingsBlockRow
        icon="person.2"
        title={t('meTab.groupManagement')}
        trailingText={t('meTab.zeroGroups')}
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

function credentialIcon(type: string): SFSymbol {
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
