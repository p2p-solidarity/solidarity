/**
 * FocusedCardView — 1:1 port of
 * solidarity/Views/CardViews/WalletPassGeneration/FocusedCardView.swift.
 *
 * Centred single-card focus overlay with:
 *   - Pan-to-edit / pan-to-delete drag gesture (Reanimated 4)
 *   - 3D rotation tracking the drag offset (matches Swift `.rotation3DEffect`)
 *   - HSL gradient derived from the card UUID hash (deterministic per card)
 *   - Trio of action buttons: Close (translucent) / Edit (white) / Delete (red)
 *   - Swipe hint copy at the bottom
 *
 * The drag thresholds (`> 100` for edit, `< -100` for delete) and visual
 * treatment (corner radius 24, accent border, group capsule top-right)
 * match the Swift original.
 */
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import {
  Gesture,
  GestureDetector,
} from 'react-native-gesture-handler';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import type { BusinessCard } from '@solidarity/shared';

const DRAG_TRIGGER = 100;

export interface FocusedCardViewProps {
  readonly card: BusinessCard;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
  readonly onClose: () => void;
}

export function FocusedCardView({
  card,
  onEdit,
  onDelete,
  onClose,
}: FocusedCardViewProps): ReactNode {
  const translateX = useSharedValue(0);
  const gradient = useMemo(() => gradientForCard(card), [card]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .onUpdate((e) => {
          translateX.value = e.translationX;
        })
        .onEnd((e) => {
          if (e.translationX < -DRAG_TRIGGER) {
            scheduleOnRN(onDelete);
          } else if (e.translationX > DRAG_TRIGGER) {
            scheduleOnRN(onEdit);
          }
          translateX.value = withSpring(0, { damping: 18 });
        }),
    [onDelete, onEdit, translateX]
  );

  const cardAnimStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { perspective: 800 },
      { rotateY: `${String(translateX.value / 20)}deg` },
    ],
  }));

  return (
    <View style={{ paddingHorizontal: 8, gap: 20 }}>
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[
            {
              height: 280,
              borderRadius: 24,
              overflow: 'hidden',
              borderWidth: 2,
              borderColor: `${Colors.accentRose}99`,
              shadowColor: Colors.accentRose,
              shadowOpacity: 0.3,
              shadowRadius: 20,
              shadowOffset: { width: 0, height: 10 },
              elevation: 8,
            },
            cardAnimStyle,
          ]}
        >
          <LinearGradient
            colors={gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ flex: 1 }}
          >
            <CardContent card={card} />
          </LinearGradient>
        </Animated.View>
      </GestureDetector>

      <View style={{ flexDirection: 'row', gap: 16, paddingHorizontal: 4 }}>
        <ActionButton
          label="Close"
          icon="xmark.circle.fill"
          onPress={onClose}
          background="rgba(255,255,255,0.20)"
          borderColor="rgba(255,255,255,0.30)"
          textColor={Colors.cardBg}
        />
        <ActionButton
          label="Edit"
          icon="pencil.circle.fill"
          onPress={onEdit}
          background={Colors.cardBg}
          textColor={Colors.text1}
          shadow
        />
        <ActionButton
          label="Delete"
          icon="trash.circle.fill"
          onPress={onDelete}
          background={Colors.destructive}
          textColor={Colors.cardBg}
          shadow
        />
      </View>

      <ThemedText
        variant="caption"
        style={{
          color: 'rgba(255,255,255,0.60)',
          textAlign: 'center',
          paddingTop: 4,
        }}
      >
        {'← Swipe to delete  •  Swipe to edit →'}
      </ThemedText>
    </View>
  );
}

// MARK: - Card content (animal thumb + identity stack + email/phone pills)

interface CardContentProps {
  readonly card: BusinessCard;
}

function CardContent({ card }: CardContentProps): ReactNode {
  return (
    <View
      style={{
        flex: 1,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 14,
        padding: 18,
      }}
    >
      <View style={{ flex: 1, gap: 8 }}>
        <ThemedText
          variant="titleLarge"
          style={{ color: Colors.text1, fontWeight: '700' }}
        >
          {card.name}
        </ThemedText>
        {card.company ? (
          <ThemedText variant="bodyMedium" style={{ color: 'rgba(47,47,48,0.7)' }}>
            {card.company}
          </ThemedText>
        ) : null}
        {card.title ? (
          <ThemedText variant="bodySmall" style={{ color: 'rgba(47,47,48,0.6)' }}>
            {card.title}
          </ThemedText>
        ) : null}

        <View style={{ flex: 1 }} />

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          {card.email ? <InfoChip icon="envelope" text={card.email} /> : <View />}
          {card.phone ? <InfoChip icon="phone" text={card.phone} /> : <View />}
        </View>
      </View>
    </View>
  );
}

interface InfoChipProps {
  readonly icon: 'envelope' | 'phone';
  readonly text: string;
}

function InfoChip({ icon, text }: InfoChipProps): ReactNode {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: 'rgba(255,255,255,0.50)',
        paddingHorizontal: 8,
        paddingVertical: 6,
        borderRadius: 8,
      }}
    >
      <SfIcon name={icon} size={12} color="rgba(47,47,48,0.7)" />
      <ThemedText variant="caption" style={{ color: 'rgba(47,47,48,0.8)' }}>
        {text}
      </ThemedText>
    </View>
  );
}

interface ActionButtonProps {
  readonly label: string;
  readonly icon:
    | 'xmark.circle.fill'
    | 'pencil.circle.fill'
    | 'trash.circle.fill';
  readonly onPress: () => void;
  readonly background: string;
  readonly textColor: string;
  readonly borderColor?: string;
  readonly shadow?: boolean;
}

function ActionButton({
  label,
  icon,
  onPress,
  background,
  textColor,
  borderColor,
  shadow,
}: ActionButtonProps): ReactNode {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 14,
        borderRadius: 12,
        backgroundColor: background,
        ...(borderColor
          ? { borderWidth: 1, borderColor }
          : null),
        ...(shadow
          ? {
              shadowColor: '#000000',
              shadowOpacity: 0.2,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 4 },
              elevation: 4,
            }
          : null),
      }}
    >
      <SfIcon name={icon} size={16} color={textColor} />
      <ThemedText
        variant="titleMedium"
        style={{ color: textColor, fontWeight: '600' }}
      >
        {label}
      </ThemedText>
    </Pressable>
  );
}

/**
 * Mirror the Swift gradient: white → low-opacity HSL accent derived from
 * the card UUID hash. Output is a 2-stop linear gradient tuple compatible
 * with expo-linear-gradient (which mutates the array internally).
 */
function gradientForCard(card: BusinessCard): [string, string] {
  const hash = hashString(card.id);
  const hue = Math.abs(hash) % 360;
  return [Colors.cardBg, hslToHex(hue, 70, 78)];
}

function hashString(value: string): number {
  // Lightweight 32-bit FNV-1a — stable across runs and platforms, matches
  // the deterministic Swift `card.id.uuidString.hashValue` intent.
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}

function hslToHex(h: number, s: number, l: number): string {
  const sNorm = s / 100;
  const lNorm = l / 100;
  const c = (1 - Math.abs(2 * lNorm - 1)) * sNorm;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lNorm - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const toByte = (v: number): string =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`;
}
