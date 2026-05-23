/**
 * MatchingBar — 1:1 port of MatchingBarView.swift.
 *
 * Small status indicator (26pt circle with pulsing ring while scanning)
 * meant to live in a nav-bar trailing slot. Tapping opens a configurable
 * detail screen via the `onPress` callback.
 *
 * Status colour mirrors Swift `proximityManager.connectionStatus`:
 *   connected → terminalGreen
 *   advertising / browsing / both → primaryBlue
 *   disconnected → text3 (dimmed)
 */
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import type { SFSymbol } from 'expo-symbols';

import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';
import { useMatchingSession } from '@/matching/session';
import type { MatchingConnectionStatus } from '@/matching/types';

const STATUS_COLOR: Readonly<Record<MatchingConnectionStatus, string>> = {
  connected: Colors.terminalGreen,
  advertising: Colors.primaryBlue,
  browsing: Colors.primaryBlue,
  advertisingAndBrowsing: Colors.primaryBlue,
  disconnected: Colors.text3,
};

const STATUS_ICON: Readonly<Record<MatchingConnectionStatus, string>> = {
  connected: 'wifi',
  advertising: 'dot.radiowaves.left.and.right',
  browsing: 'magnifyingglass',
  advertisingAndBrowsing: 'dot.radiowaves.up.forward',
  disconnected: 'wifi.slash',
};

const STATUS_TITLE: Readonly<Record<MatchingConnectionStatus, string>> = {
  connected: 'Connected',
  advertising: 'Visible to others',
  browsing: 'Looking for peers',
  advertisingAndBrowsing: 'Start matching',
  disconnected: 'Offline',
};

export function MatchingBar({ onPress }: { readonly onPress?: () => void }): ReactNode {
  const status = useMatchingSession((s) => s.connectionStatus);
  const peerCount = useMatchingSession((s) => s.peers.length);
  const isSearching = status === 'advertising' || status === 'browsing' || status === 'advertisingAndBrowsing';
  const isActive = isSearching || status === 'connected' || peerCount > 0;

  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.65);

  useEffect(() => {
    if (isSearching) {
      scale.value = withRepeat(
        withTiming(1.35, { duration: 1400, easing: Easing.out(Easing.quad) }),
        -1,
        false
      );
      opacity.value = withRepeat(
        withTiming(0, { duration: 1400, easing: Easing.out(Easing.quad) }),
        -1,
        false
      );
    } else {
      scale.value = withTiming(1, { duration: 200 });
      opacity.value = withTiming(0.65, { duration: 200 });
    }
  }, [isSearching, scale, opacity]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  const color = STATUS_COLOR[status];

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={STATUS_TITLE[status]}
      accessibilityValue={{ text: subtitle(peerCount) }}
      accessibilityHint="Opens matching status"
      style={[styles.container, { opacity: isActive ? 1 : 0.4 }]}
    >
      <View style={[styles.bg, { backgroundColor: `${color}2E` }]} />
      {isSearching ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.ring, { borderColor: `${color}8C` }, ringStyle]}
        />
      ) : null}
      <SfIcon name={iconFor(status)} size={13} weight="semibold" color={color} />
    </Pressable>
  );
}

function iconFor(status: MatchingConnectionStatus): SFSymbol {
  return STATUS_ICON[status] as SFSymbol;
}

function subtitle(count: number): string {
  if (count === 0) return 'No peers found yet';
  return `${String(count)} peer${count === 1 ? '' : 's'} nearby`;
}

const styles = StyleSheet.create({
  container: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  bg: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
  },
  ring: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
  },
});
