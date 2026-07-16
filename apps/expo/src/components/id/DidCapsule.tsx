/**
 * DidCapsule — the "Anonymous / did:key" pill displayed in the IDView mask
 * section. Mirrors `didCapsule(title:subtitle:isActive:action:)` from
 * solidarity/Views/IDViews/IDViewHelpers.swift.
 *
 * Visual: 120×50 pill, isActive => white fill + black text + drop shadow;
 * inactive => clear fill + secondary text. Spring animation on toggle.
 */
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { PressableScale } from '@/components/common/PressableScale';
import { ThemedSurface, ThemedText } from '@/components/themed';

export interface DidCapsuleProps {
  readonly title: string;
  readonly subtitle: string;
  readonly isActive: boolean;
  readonly onPress: () => void;
}

export function DidCapsule({ title, subtitle, isActive, onPress }: DidCapsuleProps): ReactNode {
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title} ${subtitle}`}>
      <ThemedSurface
        variant={isActive ? 'card' : 'outlined'}
        className="items-center justify-center rounded-none"
        style={{ width: 120, height: 50 }}>
        <View style={{ alignItems: 'center' }}>
          <ThemedText variant="label" tone={isActive ? 'primary' : 'secondary'}>
            {title}
          </ThemedText>
          <ThemedText
            variant="caption"
            tone={isActive ? 'secondary' : 'tertiary'}
            style={{ marginTop: 2 }}>
            {subtitle}
          </ThemedText>
        </View>
      </ThemedSurface>
    </PressableScale>
  );
}
