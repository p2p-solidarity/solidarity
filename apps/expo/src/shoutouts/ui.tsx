/**
 * Shared visual helpers for the Shoutouts (Sakura) feature — kept here so
 * the screen files stay under the 500-LOC ceiling.
 *
 * Includes:
 *   • verificationColor / verificationIcon — map VerificationStatus to
 *     Sakura palette + SF Symbol.
 *   • initials / relativeDate — string helpers used by gallery, detail,
 *     compose.
 *   • AvatarRing — double-ring avatar (Sakura profile hero) that breathes
 *     once on arrival (≤ 300 ms, ease-out) instead of looping forever.
 *   • SectionCard — themed mx-4 card used by the detail Information/Tags/
 *     Message-History sections.
 *   • InfoRow / MessageBullet — list rows inside the detail sections.
 *   • GridCard / ListRow — gallery tiles and rows for the Shoutouts hub
 *     (moved here to keep app/shoutouts/index.tsx under the LOC ceiling).
 */
import type { SFSymbol } from 'expo-symbols';
import { useEffect, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';
import { EASE_OUT, SCALE } from '@/feedback/motion';
import { useTranslation } from '@/i18n';
import type { Shoutout } from '@/shoutouts/store';
import type { Contact, VerificationStatus } from '@solidarity/shared';

export function verificationColor(status: VerificationStatus): string {
  switch (status) {
    case 'Verified':
      return Colors.terminalGreen;
    case 'Pending':
      return '#FF9500';
    case 'Failed':
      return Colors.destructive;
    default:
      return Colors.primaryBlue;
  }
}

export function verificationIcon(status: VerificationStatus): SFSymbol {
  switch (status) {
    case 'Verified':
      return 'checkmark.seal.fill';
    case 'Pending':
      return 'clock';
    case 'Failed':
      return 'xmark.circle.fill';
    default:
      return 'questionmark.circle';
  }
}

export function initials(name: string): string {
  return name
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function relativeDate(d: Date | undefined): string {
  if (!d) return '';
  const deltaSec = (Date.now() - d.getTime()) / 1000;
  if (deltaSec < 60) return 'just now';
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60).toFixed(0)}m ago`;
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600).toFixed(0)}h ago`;
  if (deltaSec < 86400 * 7) return `${Math.floor(deltaSec / 86400).toFixed(0)}d ago`;
  return d.toLocaleDateString();
}

export function AvatarRing({
  name,
  status,
  animating,
}: {
  readonly name: string;
  readonly status: VerificationStatus;
  readonly animating: boolean;
}): ReactNode {
  const ring = useSharedValue(0);
  const inner = useSharedValue(0);
  const reduceMotion = useReducedMotion();

  // One breath when the hero arrives: out and back in 280 ms (ring) / 240 ms
  // (inner), both on the app's ease-out. The old 800/600 ms infinite loop
  // kept the hero moving for as long as the screen was open. Reduce Motion
  // skips it (it is pure scale).
  useEffect(() => {
    if (animating && !reduceMotion) {
      ring.value = withSequence(
        withTiming(1, { duration: 140, easing: EASE_OUT }),
        withTiming(0, { duration: 140, easing: EASE_OUT })
      );
      inner.value = withSequence(
        withTiming(1, { duration: 120, easing: EASE_OUT }),
        withTiming(0, { duration: 120, easing: EASE_OUT })
      );
    } else {
      cancelAnimation(ring);
      cancelAnimation(inner);
      ring.value = 0;
      inner.value = 0;
    }
    return () => {
      cancelAnimation(ring);
      cancelAnimation(inner);
    };
  }, [animating, reduceMotion, ring, inner]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + ring.value * 0.06 }],
  }));
  const innerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + inner.value * 0.03 }],
  }));

  return (
    <View
      style={{ width: 120, height: 120, alignItems: 'center', justifyContent: 'center' }}
    >
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: 120,
            height: 120,
            borderRadius: 60,
            borderWidth: 3,
            borderColor: Colors.accentRose,
            opacity: 0.7,
          },
          ringStyle,
        ]}
      />
      <Animated.View
        style={[
          {
            width: 100,
            height: 100,
            borderRadius: 50,
            borderWidth: 3,
            borderColor: verificationColor(status),
            backgroundColor: Colors.primaryMauve,
            alignItems: 'center',
            justifyContent: 'center',
          },
          innerStyle,
        ]}
      >
        <Text className="text-cardBg" style={{ fontSize: 28, fontWeight: '700' }}>
          {initials(name)}
        </Text>
      </Animated.View>
    </View>
  );
}

export function SectionCard({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <View
      className="bg-cardBg mx-4"
      style={{
        borderRadius: 12,
        padding: 16,
        marginTop: 24,
        borderWidth: 1,
        borderColor: Colors.divider,
      }}
    >
      {children}
    </View>
  );
}

export function InfoRow({
  icon,
  title,
  value,
}: {
  readonly icon: SFSymbol;
  readonly title: string;
  readonly value: string;
}): ReactNode {
  return (
    <View className="flex-row items-start" style={{ paddingVertical: 6 }}>
      <View style={{ width: 20, alignItems: 'center', marginTop: 2 }}>
        <SfIcon name={icon} size={14} color={Colors.text1} />
      </View>
      <View style={{ marginLeft: 8, flex: 1 }}>
        <Text className="text-text1" style={{ fontSize: 14 }}>
          {title}
        </Text>
        <Text className="text-text2" style={{ fontSize: 12, marginTop: 2 }}>
          {value}
        </Text>
      </View>
    </View>
  );
}

export function MessageBullet({ message }: { readonly message: Shoutout }): ReactNode {
  return (
    <View className="flex-row items-start" style={{ paddingVertical: 4 }}>
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: Colors.accentRose,
          marginTop: 6,
        }}
      />
      <View style={{ marginLeft: 12, flex: 1 }}>
        <Text className="text-text1" style={{ fontSize: 15 }}>
          {message.body || message.subject}
        </Text>
        <Text className="text-text2" style={{ fontSize: 11, marginTop: 4 }}>
          {relativeDate(message.createdAt)}
        </Text>
      </View>
    </View>
  );
}

export function GridCard({
  contact,
  onPress,
}: {
  readonly contact: Contact;
  readonly onPress: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const { businessCard: card } = contact;
  const subtitle = [card.title, card.company].filter(Boolean).join(' · ');
  return (
    <PressableScale
      onPress={onPress}
      haptic={false}
      scaleTo={SCALE.tile}
      accessibilityRole="button"
      accessibilityLabel={t('shoutouts.openCard', { name: card.name })}
      containerStyle={{ flex: 1, minWidth: '47%' }}
      style={{ height: 180 }}
      className="bg-cardBg rounded-lg border border-divider p-3"
    >
      <View className="flex-row items-center justify-between">
        <View
          className="bg-text1 items-center justify-center"
          style={{ width: 32, height: 32, borderRadius: 16 }}
        >
          <Text className="text-cardBg" style={{ fontSize: 12, fontWeight: '700' }}>
            {initials(card.name)}
          </Text>
        </View>
        <Text className="text-text3" style={{ fontSize: 10 }}>
          {relativeDate(contact.lastInteraction ?? contact.receivedAt)}
        </Text>
      </View>
      <View style={{ marginTop: 8 }}>
        <Text
          className="text-text1"
          numberOfLines={1}
          style={{ fontSize: 16, fontWeight: '500' }}
        >
          {card.name}
        </Text>
        {subtitle ? (
          <Text
            className="text-text2"
            numberOfLines={1}
            style={{ fontSize: 14, marginTop: 4 }}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={{ flex: 1 }} />
      <View className="flex-row items-center">
        <SfIcon
          name={verificationIcon(contact.verificationStatus)}
          size={12}
          color={verificationColor(contact.verificationStatus)}
        />
        <Text className="text-text3" style={{ fontSize: 10, marginLeft: 4 }}>
          {contact.verificationStatus}
        </Text>
      </View>
    </PressableScale>
  );
}

export function ListRow({
  contact,
  onPress,
}: {
  readonly contact: Contact;
  readonly onPress: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const { businessCard: card } = contact;
  const subtitle = [card.title, card.company].filter(Boolean).join(' · ');
  return (
    <PressableScale
      onPress={onPress}
      haptic={false}
      accessibilityRole="button"
      accessibilityLabel={t('shoutouts.openCard', { name: card.name })}
    >
      <View style={{ height: 0.5, backgroundColor: Colors.divider }} />
      <View className="flex-row" style={{ paddingVertical: 12 }}>
        <View
          className="bg-text1 items-center justify-center"
          style={{ width: 32, height: 32, borderRadius: 16, marginRight: 6 }}
        >
          <Text className="text-cardBg" style={{ fontSize: 12, fontWeight: '700' }}>
            {initials(card.name)}
          </Text>
        </View>
        <View className="flex-1">
          <View className="flex-row items-start justify-between">
            <View className="flex-1" style={{ marginRight: 8 }}>
              <Text
                className="text-text1"
                numberOfLines={1}
                style={{ fontSize: 16, fontWeight: '500' }}
              >
                {card.name}
              </Text>
              {subtitle ? (
                <Text
                  className="text-text2"
                  numberOfLines={1}
                  style={{ fontSize: 14, marginTop: 2 }}
                >
                  {subtitle}
                </Text>
              ) : null}
            </View>
            <View className="items-end">
              <Text className="text-text3" style={{ fontSize: 10 }}>
                {relativeDate(contact.lastInteraction ?? contact.receivedAt)}
              </Text>
              <SfIcon
                name={verificationIcon(contact.verificationStatus)}
                size={10}
                color={verificationColor(contact.verificationStatus)}
              />
            </View>
          </View>
          <View
            style={{
              height: 0.5,
              backgroundColor: Colors.divider,
              marginVertical: 8,
            }}
          />
          <Text className="text-text3" numberOfLines={1} style={{ fontSize: 11 }}>
            {(card.company?.length ?? 0) > 0 ? card.company : contact.verificationStatus}
          </Text>
        </View>
      </View>
    </PressableScale>
  );
}
