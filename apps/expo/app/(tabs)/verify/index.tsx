/**
 * Verify tab — 1.3.3 Task A0.2 skeleton.
 *
 * Layout (top → bottom):
 *   1. NavBar — nav title "Verify" (inline, no side chrome yet).
 *   2. Scan entry — reuses the existing `/scan` route (which itself wraps
 *      `src/scan/QrScanner.tsx`). Verification result cards / badge
 *      binding wizards land in later phases (docs/ref/04-plan-app.md
 *      Phase A2.3+) — this is only the navigation skeleton.
 *   3. Sections moved from the old Me tab lower half, unmodified:
 *        "Verified Credentials" (scan/manual/import empty state, or a
 *        VerifiedCredentialRow per credential)
 *        "Selective Disclosures" (DisclosureRowView per claim)
 *        "Action" (Acquire New Proof / Import Raw Credential)
 *        "OIDC Request" — the OIDC Request Scanner row. Per
 *        docs/ref/03-app-web-mechanisms.md §6, OIDC/OpenPubkey is a kept
 *        (not frozen) mechanism — already reachable outside developer mode
 *        elsewhere (Settings › Verifiable Credentials, Credentials list) —
 *        so it surfaces here too, ungated.
 *
 *   ZK Identity and Group Management are NOT here: per §6 they're frozen
 *   features (Semaphore/CloudKit group sync — roadmap US-17), reachable
 *   only via existing developer settings screens (Settings › Advanced ›
 *   Developer Tools, and the standalone `/id` screen), not this tab.
 */
import { router } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SFSymbol } from 'expo-symbols';

import { useCardStore, useMyCardDetail } from '@/cards/cardManager';
import {
  DisclosureRowView,
  MeActionTile,
  MeSectionHeader,
  SettingsBlockRow,
  SettingsBlockSection,
  VerifiedCredentialRow,
} from '@/components/me';
import { credentialTrustDisplayFor } from '@/credentials/trustDisplay';
import { STAGGER_MS } from '@/feedback/motion';
import { useTranslation } from '@/i18n';
import {
  useDisplayClaims,
  useIdentityData,
  type IdentityCardEntity,
  type ProvableClaimEntity,
} from '@/identity';

export default function VerifyTab() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const identityCards = useIdentityData((s) => s.identityCards);
  const hydrateCards = useCardStore((s) => s.hydrate);
  const hydrateIdentity = useIdentityData((s) => s.hydrate);

  useEffect(() => {
    void hydrateCards();
    void hydrateIdentity();
  }, [hydrateCards, hydrateIdentity]);

  // Work/group presentation context — same derivation as the old Me tab
  // (BusinessCard.groupContext = .group(info)); REAL only, no placeholder.
  const cardDetail = useMyCardDetail();
  const workContext = useMemo(() => {
    const ctx = cardDetail?.groupContext;
    if (ctx?.type === 'group') {
      return { groupId: ctx.info.groupId, groupName: ctx.info.groupName };
    }
    return null;
  }, [cardDetail?.groupContext]);

  // Swift parity: filter out the business-card-backed identity entry.
  const verifiedCreds = useMemo(
    () => identityCards.filter((c) => c.type !== 'business_card'),
    [identityCards]
  );
  const disclosures = useDisplayClaims();

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <NavBar title={t('tab.verify')} />

      <ScrollView contentContainerStyle={{ paddingTop: 12, paddingBottom: 100 }}>
        <View className="gap-8">
          <Animated.View entering={FadeInDown.duration(360)}>
            <ScanEntrySection onScan={() => router.push('/scan')} />
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
            <SelectiveDisclosuresSection claims={disclosures} workContext={workContext} />
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(360).delay(STAGGER_MS * 3)}>
            <ActionSection
              onAcquire={() => router.push('/passport')}
              onImportRaw={() => router.push('/credentials')}
            />
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(360).delay(STAGGER_MS * 4)}>
            <OidcSection onOidc={() => router.push('/settings/oidc-request')} />
          </Animated.View>
        </View>
      </ScrollView>
    </View>
  );
}

function NavBar({ title }: { title: string }) {
  return (
    <View
      className="flex-row items-center justify-center px-4"
      style={{ height: 44 }}
    >
      <Text className="text-text1 text-[17px] font-semibold">{title}</Text>
    </View>
  );
}

function ScanEntrySection({ onScan }: { onScan: () => void }) {
  const { t } = useTranslation();
  return (
    <View className="px-4 gap-2">
      <MeActionTile icon="qrcode.viewfinder" title={t('verifyTab.scan')} onPress={onScan} />
      <Text className="text-text3 text-[12px] px-1">{t('verifyTab.scanSubtitle')}</Text>
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
              trustLevel={credentialTrustDisplayFor(c).level}
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
  workContext,
}: {
  readonly claims: readonly ProvableClaimEntity[];
  /** Real work/group context derived from the user's card; null when none. */
  readonly workContext: { readonly groupId: string; readonly groupName: string } | null;
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
          {claims.map((c) => {
            // The "Work" action only exists for the business card itself
            // (the `profile_card` claim), and only when the card carries a
            // real group context. Passport claims (age/human/name) have no
            // work scope, so they never get the button.
            const canPresentInWork =
              workContext !== null && c.claimType === 'profile_card';
            return (
              <DisclosureRowView
                key={c.id}
                icon={claimIcon(c.claimType)}
                title={c.title}
                source={`Src:${capitalize(c.source)}`}
                actionTitle={t('meTab.show')}
                onPresent={() => {
                  router.push({
                    pathname: '/credentials/[id]',
                    params: { id: c.identityCardId, claimId: c.id },
                  });
                }}
                work={
                  canPresentInWork
                    ? {
                        title: t('meTab.work'),
                        accessibilityLabel: t('meTab.workAccessibility', {
                          group: workContext.groupName,
                        }),
                        onPress: () => {
                          router.push({
                            pathname: '/credentials/[id]',
                            params: {
                              id: c.identityCardId,
                              claimId: c.id,
                              context: 'work',
                              groupId: workContext.groupId,
                            },
                          });
                        },
                      }
                    : undefined
                }
              />
            );
          })}
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

function OidcSection({ onOidc }: { onOidc: () => void }) {
  const { t } = useTranslation();
  return (
    <SettingsBlockSection title={t('oidcRequest.title')}>
      <SettingsBlockRow
        icon="qrcode"
        title={t('meTab.oidcRequestScanner')}
        onPress={onOidc}
        isLast
      />
    </SettingsBlockSection>
  );
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
