/**
 * DidCapsule — the "Anonymous / did:key" pill displayed in the IDView mask
 * section. Mirrors `didCapsule(title:subtitle:isActive:action:)` from
 * solidarity/Views/IDViews/IDViewHelpers.swift.
 *
 * Visual: 120×50 pill, isActive => white fill + black text + drop shadow;
 * inactive => clear fill + secondary text. Spring animation on toggle.
 */
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Colors } from '@/constants/Colors';

export interface DidCapsuleProps {
  readonly title: string;
  readonly subtitle: string;
  readonly isActive: boolean;
  readonly onPress: () => void;
}

export function DidCapsule({
  title,
  subtitle,
  isActive,
  onPress,
}: DidCapsuleProps): ReactNode {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title} ${subtitle}`}
      style={{
        width: 120,
        height: 50,
        borderRadius: 25,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: isActive ? Colors.cardBg : 'transparent',
        shadowColor: '#000',
        shadowOpacity: isActive ? 0.1 : 0,
        shadowRadius: 2,
        shadowOffset: { width: 0, height: 1 },
      }}
    >
      <View style={{ alignItems: 'center' }}>
        <Text
          style={{
            fontSize: 15,
            fontWeight: '500',
            color: isActive ? Colors.text1 : Colors.text2,
          }}
        >
          {title}
        </Text>
        <Text
          style={{
            fontSize: 11,
            color: isActive ? `${Colors.text1}CC` : `${Colors.text2}99`,
            marginTop: 2,
          }}
        >
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}
