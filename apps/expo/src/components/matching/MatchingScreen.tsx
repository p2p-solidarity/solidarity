/**
 * MatchingScreen — 1:1 port of MatchingView.swift. Thin full-page wrapper
 * around MatchingRoot, suitable for a router-mounted screen (e.g.
 * `apps/expo/app/share/matching.tsx`). Mirrors the SwiftUI hierarchy
 * (MatchingView → MatchingRootView) we keep the names for parity.
 */
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '@/constants/Colors';

import { MatchingRoot } from './MatchingRoot';

export interface MatchingScreenProps {
  readonly orbitSize?: number;
  readonly enableSharePicker?: boolean;
}

export function MatchingScreen({
  orbitSize,
  enableSharePicker = true,
}: MatchingScreenProps): ReactNode {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <MatchingRoot orbitSize={orbitSize} enableSharePicker={enableSharePicker} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.pageBg, alignItems: 'center', justifyContent: 'center' },
});
