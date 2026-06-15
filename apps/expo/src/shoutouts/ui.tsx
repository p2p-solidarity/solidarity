/**
 * Shared visual helpers for the Shoutouts (Sakura) feature — kept here so
 * the screen files stay under the 500-LOC ceiling.
 *
 * Includes:
 *   • verificationColor / verificationIcon — map VerificationStatus to
 *     Sakura palette + SF Symbol.
 *   • initials / relativeDate — string helpers used by gallery, detail,
 *     compose.
 *   • AvatarRing — animated double-ring avatar (Sakura profile hero).
 *   • SectionCard — themed mx-4 card used by the detail Information/Tags/
 *     Message-History sections.
 *   • InfoRow / MessageBullet — list rows inside the detail sections.
 */
import type { SFSymbol } from 'expo-symbols';
import { useEffect, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';
import type { Shoutout } from '@/shoutouts/store';
import type { VerificationStatus } from '@solidarity/shared';

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
  const ring = useSharedValue(animating ? 1 : 0);
  const inner = useSharedValue(animating ? 1 : 0);

  useEffect(() => {
    if (animating) {
      ring.value = withRepeat(
        withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      );
      inner.value = withRepeat(
        withTiming(1, { duration: 600, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
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
  }, [animating, ring, inner]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + ring.value * 0.1 }],
  }));
  const innerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + inner.value * 0.05 }],
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
