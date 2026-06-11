/**
 * Solidarity QR — 1:1 port of
 * solidarity/Views/SettingsViews/SolidarityQRView.swift.
 *
 * Renders a single rounded card with:
 *   • "Solidarity QR" sub-headline (semibold, textPrimary)
 *   • Square QR area on a white background — generated through the same
 *     DID-signed-first, plaintext-fallback flow Swift's QRCodeManager uses.
 *   • Caption "Use this mode when both users are in Solidarity for direct
 *     exchange." centred under the QR.
 *
 * Expo does not yet persist Swift's `defaultSharingLevel` key, so this uses
 * Swift's default professional level. Field toggles mirror
 * ShareSettingsStore via `usePreferences`.
 */
import { router, Stack } from 'expo-router';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCardStore, useMyCardDetail } from '@/cards/cardManager';
import { generateQrPng } from '@/cards/qrCodeManager';
import type { ShareFieldPreferences } from '@/cards/solidarityQrPayload';
import { buildRuntimeSolidarityQrWire } from '@/cards/solidarityQrRuntime';
import {
  SettingsBackToolbar,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { Colors } from '@/constants/Colors';
import { useHasClaim, useIdentityData } from '@/identity';
import { useTranslation } from '@/i18n';
import { usePreferences } from '@/settings/preferences';

export default function SolidarityQrSettings() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const card = useMyCardDetail();
  const hydrateCards = useCardStore((s) => s.hydrate);
  const hydrateIdentity = useIdentityData((s) => s.hydrate);
  useEffect(() => {
    void hydrateCards();
    void hydrateIdentity();
  }, [hydrateCards, hydrateIdentity]);
  const [qrImageUri, setQrImageUri] = useState<string | null>(null);
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

  useEffect(() => {
    if (!card) {
      setQrImageUri(null);
      return;
    }

    let cancelled = false;
    const shareFieldPreferences: ShareFieldPreferences = {
      shareTitle,
      shareCompany,
      shareEmail,
      sharePhone,
      shareProfileImage,
      shareSocialNetworks,
      shareSkills,
    };
    const proofClaims: string[] = [];
    if (hasHumanClaim && shareIsHuman) proofClaims.push('is_human');
    if (hasAgeClaim && shareAgeOver18) proofClaims.push('age_over_18');

    setQrImageUri(null);
    void buildRuntimeSolidarityQrWire(
      card,
      shareFieldPreferences,
      { proofClaims }
    )
      .then((next) =>
        generateQrPng(next.wire, { size: 260, startingLevel: next.startingLevel })
      )
      .then((next) => {
        if (!cancelled) setQrImageUri(next);
      })
      .catch(() => {
        if (!cancelled) setQrImageUri(null);
      });

    return () => {
      cancelled = true;
    };
  }, [
    card,
    hasAgeClaim,
    hasHumanClaim,
    shareAgeOver18,
    shareCompany,
    shareEmail,
    shareIsHuman,
    sharePhone,
    shareProfileImage,
    shareSkills,
    shareSocialNetworks,
    shareTitle,
  ]);

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <Stack.Screen options={{ presentation: 'modal' }} />
      <SettingsBackToolbar title={t('solidarityQr.close')} onPress={() => { router.back(); }} />
      <SettingsScreenTitle title={t('solidarityQr.title')} />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 24 + insets.bottom }}
      >
        <View className="px-4 gap-3">
          <View
            className="bg-cardBg rounded-xl"
            style={{
              padding: 12,
              borderWidth: 0.5,
              borderColor: Colors.divider,
            }}
          >
            <View className="items-center gap-3">
              <Text className="text-text1 text-[15px] font-semibold">
                Solidarity QR
              </Text>

              <View
                className="rounded-xl"
                style={{
                  backgroundColor: '#FFFFFF',
                  width: '100%',
                  aspectRatio: 1,
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 12,
                }}
              >
                {qrImageUri ? (
                  <Image
                    source={{ uri: qrImageUri }}
                    contentFit="contain"
                    style={{
                      width: 260,
                      height: 260,
                    }}
                  />
                ) : (
                  <ActivityIndicator color={Colors.accentRose} />
                )}
              </View>

              <Text
                className="text-text2 text-[12px] text-center"
                style={{ paddingHorizontal: 8 }}
              >
                {t('solidarityQr.caption')}
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
