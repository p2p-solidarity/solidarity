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
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCardStore, useMyCard } from '@/cards/cardManager';
import { toVCard } from '@/cards/vCard';
import { SfIcon } from '@/components/icons/SfIcon';
import { RadarMatching } from '@/components/share/RadarMatching';
import { QrShareCard } from '@/components/share/QrShareCard';
import {
  type EnabledField,
  FieldPillRow as _FieldPillRow,
} from '@/components/share/FieldPillRow';
import {
  UwbStatusPill,
  type UwbSpatialState,
} from '@/components/share/UwbStatusPill';
import { ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';

// Default share field set mirrors Swift ShareSettingsReader defaults
// (everything checked except socialNetworks/skills until user opts in).
const DEFAULT_FIELDS: readonly EnabledField[] = [
  'name',
  'title',
  'company',
  'email',
  'phone',
  'profileImage',
];

export default function ShareTab() {
  const myCard = useMyCard();
  const hydrate = useCardStore((s) => s.hydrate);
  const insets = useSafeAreaInsets();
  const [isMatching, setIsMatching] = useState(false);
  const [peerCount] = useState(0);
  const [uwb] = useState<UwbSpatialState>({ kind: 'idle' });

  useEffect(() => { void hydrate(); }, [hydrate]);

  const payload = useMemo(() => (myCard ? toVCard(myCard) : undefined), [myCard]);
  const statusTitle = isMatching ? 'Scanning Nearby' : 'Ready To Match';
  const subtitle = statusSubtitle(isMatching, peerCount);
  const uwbVisible = uwb.kind !== 'idle';

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <NavBar onScan={() => router.push('/scan')} />

      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        <View className="items-center" style={{ height: 260 }}>
          <Pressable
            onPress={() => {
              if (peerCount > 0) {
                // TODO: open NearbyPeersSheet once ported
              }
            }}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
          >
            <RadarMatching avatar="📡" />
          </Pressable>
        </View>

        <View style={{ height: 16 }} />

        <View className="items-center gap-2">
          <Text className="text-text1 text-[20px] font-bold">{statusTitle}</Text>
          <Text className="text-text2 text-[13px] text-center px-10">
            {subtitle}
          </Text>
        </View>

        <View style={{ height: 16 }} />

        <View className="px-12">
          <ThemedButton
            label={isMatching ? 'Stop Matching' : 'Start Matching'}
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
            onPress={() => setIsMatching((b) => !b)}
          />
        </View>

        {uwbVisible ? (
          <View style={{ paddingTop: 10 }}>
            <UwbStatusPill state={uwb} distanceMeters={undefined} />
          </View>
        ) : null}

        <View style={{ height: 24 }} />

        <View className="px-4">
          <QrShareCard
            payload={payload}
            cardName={myCard?.name}
            enabledFields={DEFAULT_FIELDS}
            hasRealHuman={false}
            onOpenSettings={() => router.push('/settings')}
            onShare={() => {
              // TODO: wire native ShareSheet via expo-sharing
            }}
          />
        </View>
      </ScrollView>
    </View>
  );
}

function NavBar({ onScan }: { onScan: () => void }) {
  return (
    <View
      className="flex-row items-center justify-between px-4"
      style={{ height: 44 }}
    >
      <Pressable
        onPress={onScan}
        accessibilityRole="button"
        style={{ width: 44, height: 44, alignItems: 'flex-start', justifyContent: 'center' }}
        className="active:opacity-60"
      >
        <SfIcon name="qrcode.viewfinder" size={20} color={Colors.text1} />
      </Pressable>
      <Text className="text-text1 text-[17px] font-semibold">Share</Text>
      <View style={{ width: 44 }} />
    </View>
  );
}

function statusSubtitle(isMatching: boolean, peerCount: number): string {
  if (!isMatching) return 'Start matching to discover nearby people.';
  if (peerCount === 0) return 'Searching for nearby peers...';
  if (peerCount === 1) return 'Found 1 nearby peer. Tap the radar to connect.';
  return `Found ${String(peerCount)} nearby peers. Tap the radar to connect.`;
}
