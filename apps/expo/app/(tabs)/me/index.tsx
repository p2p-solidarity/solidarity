/**
 * Me tab — 1.3.3 Task A0.2 "verified card" conversion.
 *
 * Layout (top → bottom):
 *   1. NavBar — nav title "Me" (inline) + trailing gearshape → /settings
 *   2. VerifiedCard — merged identity header (avatar/name/DID/Edit) + badge
 *      row (honest empty state) + the old Share-tab QR expand card, all in
 *      one expandable component (`src/components/me/VerifiedCard.tsx`).
 *
 * The old lower half (Verified Credentials / Selective Disclosures / Action
 * / Developer sections) moved to the Verify tab as-is — see
 * `app/(tabs)/verify/index.tsx`. Per docs/ref/03-app-web-mechanisms.md §5/§6:
 * Share tab is deleted (its QR card merges in here), ZK Identity + Group
 * Management are frozen features reachable only via existing developer
 * settings screens (not this tab), and OIDC Request Scanner — a live,
 * non-frozen mechanism already reachable outside dev mode elsewhere — moved
 * to Verify alongside the other credential sections.
 *
 * QR generation mirrors the deleted `app/(tabs)/share/index.tsx` 1:1
 * (debounced `buildRuntimeSolidarityQrWire` → `generateQrPng`).
 */
import { Image as ExpoImage } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { animalImageSource } from '@/cards/animals';
import { useCardStore, useMyCard, useMyCardDetail } from '@/cards/cardManager';
import { generateQrPng } from '@/cards/qrCodeManager';
import {
  enabledFieldsFromSharePreferences,
  type ShareFieldPreferences,
} from '@/cards/solidarityQrPayload';
import { buildRuntimeSolidarityQrWire } from '@/cards/solidarityQrRuntime';
import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { VerifiedCard } from '@/components/me';
import { Colors } from '@/constants/Colors';
import { useThemeColors } from '@/constants/useThemeColors';
import { useTranslation } from '@/i18n';
import { SCALE } from '@/feedback/motion';
import {
  useActiveDid,
  useHasClaim,
  useIdentityCoordinator,
  useIdentityData,
} from '@/identity';
import { usePreferences } from '@/settings/preferences';

export default function MeTab() {
  const { t } = useTranslation();
  const card = useMyCard();
  const cardDetail = useMyCardDetail();
  const hydrateCards = useCardStore((s) => s.hydrate);
  const hydrateIdentity = useIdentityData((s) => s.hydrate);
  const seedKeychain = useIdentityCoordinator((s) => s.seedFromKeychain);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    void hydrateCards();
    void hydrateIdentity();
    void seedKeychain();
  }, [hydrateCards, hydrateIdentity, seedKeychain]);

  const displayName = card?.name ?? t('meTab.fallbackName');
  const activeDid = useActiveDid();
  const displayDid = activeDid ?? t('meTab.initializingDid');

  const shareTitle = usePreferences((s) => s.shareTitle);
  const shareCompany = usePreferences((s) => s.shareCompany);
  const shareEmail = usePreferences((s) => s.shareEmail);
  const sharePhone = usePreferences((s) => s.sharePhone);
  const shareProfileImage = usePreferences((s) => s.shareProfileImage);
  const shareSocialNetworks = usePreferences((s) => s.shareSocialNetworks);
  const shareSkills = usePreferences((s) => s.shareSkills);
  const shareIsHuman = usePreferences((s) => s.shareIsHuman);
  const shareAgeOver18 = usePreferences((s) => s.shareAgeOver18);
  const hasHumanClaim = useHasClaim('is_human');
  const hasAgeClaim = useHasClaim('age_over_18');

  const shareFieldPreferences = useMemo<ShareFieldPreferences>(
    () => ({
      shareTitle,
      shareCompany,
      shareEmail,
      sharePhone,
      shareProfileImage,
      shareSocialNetworks,
      shareSkills,
    }),
    [
      shareCompany,
      shareEmail,
      sharePhone,
      shareProfileImage,
      shareSkills,
      shareSocialNetworks,
      shareTitle,
    ]
  );
  const enabledFields = useMemo(
    () => enabledFieldsFromSharePreferences(shareFieldPreferences),
    [shareFieldPreferences]
  );
  const selectedProofClaims = useMemo<readonly string[]>(() => {
    const out: string[] = [];
    if (hasHumanClaim && shareIsHuman) out.push('is_human');
    if (hasAgeClaim && shareAgeOver18) out.push('age_over_18');
    return out;
  }, [hasAgeClaim, hasHumanClaim, shareAgeOver18, shareIsHuman]);

  // Own-QR generation — 1:1 port of the deleted Share tab's effect
  // (debounced so rapid preference toggles don't fire a build per keystroke).
  const [qrImageUri, setQrImageUri] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!cardDetail) {
      setQrImageUri(undefined);
      return;
    }
    let cancelled = false;
    setQrImageUri(undefined);
    const timer = setTimeout(() => {
      void buildRuntimeSolidarityQrWire(cardDetail, shareFieldPreferences, {
        proofClaims: selectedProofClaims,
      })
        .then((next) => generateQrPng(next.wire, { startingLevel: next.startingLevel }))
        .then((nextImageUri) => {
          if (!cancelled) setQrImageUri(nextImageUri);
        })
        .catch(() => {
          if (!cancelled) setQrImageUri(undefined);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [cardDetail, selectedProofClaims, shareFieldPreferences]);

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <NavBar onSettings={() => router.push('/settings')} />

      <ScrollView contentContainerStyle={{ paddingTop: 12, paddingBottom: 100 }}>
        <Animated.View entering={FadeInDown.duration(360)}>
          <VerifiedCard
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
            qrImageUri={qrImageUri}
            cardName={card?.name}
            enabledFields={enabledFields}
            hasRealHuman={hasHumanClaim && shareIsHuman}
            onOpenSettings={() => { router.push('/settings/share-settings'); }}
            onShare={() => { router.push('/share/qr'); }}
          />
        </Animated.View>
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
