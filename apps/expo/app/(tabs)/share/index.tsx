/**
 * Share tab — 1:1 port of solidarity/Views/SharingViews/SharingTabView.swift.
 *
 * Layout (top → bottom):
 *   1. Nav bar: "Share" (inline) + leading qrcode.viewfinder → ScanTabView
 *   2. RadarMatchingView hero (260pt, tap → NearbyPeersSheet if peers>0)
 *   3. Status block (20pt bold "Ready To Match"/"Scanning Nearby" +
 *      13pt textSecondary subtitle, dynamic based on peer count)
 *   4. Start/Stop Matching button (radio/stop SF Symbol + label, primary
 *      themed, 48pt horiz pad)
 *   5. UWB pill (when supported+active)
 *   6. QrShareCard (white QR area + featuredCardBg footer)
 */
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCardStore, useMyCard, useMyCardDetail } from '@/cards/cardManager';
import {
  enabledFieldsFromSharePreferences,
  type ShareFieldPreferences,
} from '@/cards/solidarityQrPayload';
import { generateQrPng } from '@/cards/qrCodeManager';
import { buildRuntimeSolidarityQrWire } from '@/cards/solidarityQrRuntime';
import { SfIcon } from '@/components/icons/SfIcon';
import { RadarMatching } from '@/components/share/RadarMatching';
import { QrShareCard } from '@/components/share/QrShareCard';
import { FieldPillRow as _FieldPillRow } from '@/components/share/FieldPillRow';
import { UwbStatusPill } from '@/components/share/UwbStatusPill';
import {
  NearbyPeersSheet,
  IncomingInvitationPopup,
} from '@/components/matching';
import { useMatchingSession } from '@/matching/session';
import { ensureProximityPermissions } from '@/matching/permissions';
import { ThemedButton } from '@/components/themed';
import { PressableScale } from '@/components/common/PressableScale';
import { Colors } from '@/constants/Colors';
import { useThemeColors } from '@/constants/useThemeColors';
import { useTranslation } from '@/i18n';
import { pushToast } from '@/feedback/toast';
import { SCALE, STAGGER_MS } from '@/feedback/motion';
import { usePreferences } from '@/settings/preferences';
import { useHasClaim, useIdentityData } from '@/identity';

export default function ShareTab() {
  const { t } = useTranslation();
  const myCard = useMyCard();
  const myCardDetail = useMyCardDetail();
  const hydrate = useCardStore((s) => s.hydrate);
  const hydrateIdentity = useIdentityData((s) => s.hydrate);
  const insets = useSafeAreaInsets();
  const peers = useMatchingSession((s) => s.peers);
  const peerCount = peers.length;
  const isAdvertising = useMatchingSession((s) => s.isAdvertising);
  const isBrowsing = useMatchingSession((s) => s.isBrowsing);
  const isMatching = isAdvertising || isBrowsing;
  const pendingInvitations = useMatchingSession((s) => s.pendingInvitations);
  const acceptInvitation = useMatchingSession((s) => s.acceptInvitation);
  const declineInvitation = useMatchingSession((s) => s.declineInvitation);
  const startBrowsing = useMatchingSession((s) => s.startBrowsing);
  const startAdvertising = useMatchingSession((s) => s.startAdvertising);
  const stopAll = useMatchingSession((s) => s.stopAll);
  const uwb = useMatchingSession((s) => s.uwbSpatial);
  const lastErrorMessage = useMatchingSession((s) => s.lastErrorMessage);
  const clearError = useMatchingSession((s) => s.clearError);
  const setTransportMode = useMatchingSession((s) => s.setTransportMode);
  const proximityTransport = usePreferences((s) => s.proximityTransport);
  const [nearbyVisible, setNearbyVisible] = useState(false);
  const [qrImageUri, setQrImageUri] = useState<string | undefined>(undefined);
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
    void hydrate();
    void hydrateIdentity();
  }, [hydrate, hydrateIdentity]);

  // Keep the matching session's transport in sync with the developer pref so
  // the next advertise/browse uses the selected mode.
  useEffect(() => {
    void setTransportMode(proximityTransport);
  }, [proximityTransport, setTransportMode]);

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

  useEffect(() => {
    if (!myCardDetail) {
      setQrImageUri(undefined);
      return;
    }

    let cancelled = false;
    setQrImageUri(undefined);
    const timer = setTimeout(() => {
      void buildRuntimeSolidarityQrWire(
        myCardDetail,
        shareFieldPreferences,
        { proofClaims: selectedProofClaims }
      )
        .then((next) =>
          generateQrPng(next.wire, { startingLevel: next.startingLevel })
        )
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
  }, [myCardDetail, selectedProofClaims, shareFieldPreferences]);

  const statusTitle = isMatching ? t('shareTab.scanningNearby') : t('shareTab.readyToMatch');
  const subtitle = statusSubtitle(t, isMatching, peerCount);
  const uwbVisible = uwb.kind !== 'idle';
  const currentInvitation = pendingInvitations[0];

  // Swift `toggleMatching` → ProximityManager.startMatching(card, autoSendCardOnConnect:true)
  // i.e. advertise + browse simultaneously with the user's primary card.
  //
  // Android 12+ requires the "Nearby devices" runtime grant before any BLE
  // call — without it the native module throws and the session swallows the
  // error, which read as a dead button. Request up-front and bail honestly
  // (with a toast) instead of optimistically flipping into a matching state
  // that can never find a peer.
  const toggleMatching = async (): Promise<void> => {
    if (isMatching) {
      void stopAll();
      return;
    }
    const perm = await ensureProximityPermissions();
    if (!perm.granted) {
      pushToast(
        perm.reason === 'unavailable'
          ? t('shareTab.bluetoothUnavailable')
          : t('shareTab.bluetoothPermissionNeeded'),
        'warning'
      );
      return;
    }
    void startBrowsing();
    if (myCard) {
      void startAdvertising(myCard.name, 'professional', {
        name: myCard.name,
        ...(myCard.title ? { title: myCard.title } : {}),
        ...(myCard.company ? { company: myCard.company } : {}),
        ...(myCard.animal ? { animal: myCard.animal } : {}),
      });
    }
  };

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <NavBar onScan={() => { router.push('/scan'); }} />

      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        <View className="items-center justify-center" style={{ height: 260 }}>
          <PressableScale
            haptic={peerCount > 0 ? 'tap' : false}
            scaleTo={peerCount > 0 ? 0.96 : 1}
            onPress={() => {
              if (peerCount > 0) setNearbyVisible(true);
            }}
            style={{ alignItems: 'center', justifyContent: 'center' }}
          >
            <RadarMatching size={260} isMatching={isMatching} peers={peers} />
          </PressableScale>
        </View>

        <View style={{ height: 16 }} />

        <Animated.View entering={FadeInDown.duration(360)}>
          <View className="items-center gap-2">
            <Text className="text-text1 text-[20px] font-bold">{statusTitle}</Text>
            <Text className="text-text2 text-[13px] text-center px-10">
              {subtitle}
            </Text>
          </View>
        </Animated.View>

        <View style={{ height: 16 }} />

        <Animated.View entering={FadeInDown.duration(360).delay(STAGGER_MS)}>
          <View className="px-12">
            <ThemedButton
              label={isMatching ? t('shareTab.stopMatching') : t('shareTab.startMatching')}
              fullWidth
              haptic="warning"
              leadingIcon={
                <SfIcon
                  name={isMatching ? 'stop.fill' : 'dot.radiowaves.left.and.right'}
                  size={15}
                  weight="semibold"
                  color={Colors.invertedButtonText}
                />
              }
              onPress={() => { void toggleMatching(); }}
            />
          </View>
        </Animated.View>

        {lastErrorMessage ? (
          <View style={{ paddingHorizontal: 24, paddingTop: 12 }}>
            <PressableScale
              haptic="tap"
              onPress={() => { clearError(); }}
              accessibilityRole="button"
              accessibilityLabel={t('shareTab.dismissError')}
              className="bg-mutedSurface rounded-xl flex-row items-center"
              style={{ paddingHorizontal: 12, paddingVertical: 10, gap: 8 }}
            >
              <SfIcon
                name="exclamationmark.triangle.fill"
                size={14}
                color={Colors.warning}
              />
              <Text className="text-text2 text-[12px] flex-1">{lastErrorMessage}</Text>
              <SfIcon name="xmark" size={11} weight="semibold" color={Colors.text3} />
            </PressableScale>
          </View>
        ) : null}

        {uwbVisible ? (
          <View style={{ paddingTop: 10 }}>
            <UwbStatusPill state={uwb} distanceMeters={undefined} />
          </View>
        ) : null}

        <View style={{ height: 24 }} />

        <Animated.View entering={FadeInDown.duration(360).delay(STAGGER_MS * 2)}>
          <View className="px-4">
            <QrShareCard
              qrImageUri={qrImageUri}
              cardName={myCard?.name}
              enabledFields={enabledFields}
              hasRealHuman={hasHumanClaim && shareIsHuman}
              onOpenSettings={() => { router.push('/settings/share-settings'); }}
              onShare={() => { router.push('/share/qr'); }}
            />
          </View>
        </Animated.View>
      </ScrollView>

      <NearbyPeersSheet
        visible={nearbyVisible}
        onClose={() => { setNearbyVisible(false); }}
        onViewLatestCard={() => { setNearbyVisible(false); }}
        onSelectPeer={() => { /* future: open peer detail */ }}
      />

      {currentInvitation ? (
        <IncomingInvitationPopup
          peerId={currentInvitation.peerId}
          onAccept={() => { void acceptInvitation(currentInvitation.peerId); }}
          onDecline={() => { void declineInvitation(currentInvitation.peerId); }}
          onDismiss={() => { void declineInvitation(currentInvitation.peerId); }}
        />
      ) : null}
    </View>
  );
}

function NavBar({ onScan }: { onScan: () => void }) {
  const c = useThemeColors();
  const { t } = useTranslation();
  return (
    <View
      className="flex-row items-center justify-between px-4"
      style={{ height: 44 }}
    >
      <PressableScale
        haptic="tap"
        scaleTo={SCALE.icon}
        onPress={onScan}
        accessibilityRole="button"
        accessibilityLabel={t('shareTab.scan')}
        style={{ width: 44, height: 44, alignItems: 'flex-start', justifyContent: 'center' }}
      >
        <SfIcon name="qrcode.viewfinder" size={20} color={c.text1} />
      </PressableScale>
      <Text className="text-text1 text-[17px] font-semibold">{t('tab.share')}</Text>
      <View style={{ width: 44 }} />
    </View>
  );
}

function statusSubtitle(
  t: (key: string, options?: Record<string, unknown>) => string,
  isMatching: boolean,
  peerCount: number,
): string {
  if (!isMatching) return t('shareTab.subtitleIdle');
  if (peerCount === 0) return t('shareTab.subtitleSearching');
  if (peerCount === 1) return t('shareTab.subtitleOnePeer');
  return t('shareTab.subtitleManyPeers', { count: peerCount });
}
