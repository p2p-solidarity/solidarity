/**
 * GroupCardChip — 1:1 port of Swift GroupCardView
 *   (solidarity/Views/IDViews/GroupCardView.swift).
 *
 * 160×200 rounded card with:
 *   • Header: person.3.fill icon chip + status badge
 *   • Body: monospaced 12pt name (2-line) + memberIndex caption
 *   • Background: status-gradient + two abstract circles
 *   • Outline: 3pt textPrimary border when selected, 1.05× scale spring
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';

const MONO_FONT = 'Menlo';

export type GroupChipStatus = 'active' | 'outdated' | 'pending' | 'notMember';

export interface GroupChipMembership {
  readonly id: string;
  readonly name: string;
  readonly memberIndex: number | null;
  readonly status: GroupChipStatus;
}

export interface GroupCardChipProps {
  readonly membership: GroupChipMembership;
  readonly isSelected: boolean;
  readonly onPress: () => void;
}

const GRADIENT_BY_STATUS: Readonly<
  Record<GroupChipStatus, readonly [string, string]>
> = {
  active: [Colors.primaryBlue, Colors.dustyMauve],
  outdated: [Colors.accentRose, Colors.destructive],
  pending: [Colors.text3, `${Colors.text3}B3`],
  notMember: [`${Colors.text3}CC`, `${Colors.text3}99`],
};

function StatusBadge({ status }: { readonly status: GroupChipStatus }): ReactNode {
  let content: ReactNode;
  switch (status) {
    case 'active':
      content = (
        <SfIcon
          name="checkmark.circle.fill"
          size={14}
          color={Colors.terminalGreen}
        />
      );
      break;
    case 'outdated':
      content = (
        <SfIcon
          name="exclamationmark.triangle.fill"
          size={14}
          color={Colors.dustyMauve}
        />
      );
      break;
    case 'pending':
      content = <ActivityIndicator size="small" color={Colors.text1} />;
      break;
    case 'notMember':
      content = (
        <SfIcon name="circle" size={14} color={`${Colors.text1}80`} />
      );
      break;
  }
  return (
    <View
      style={{
        padding: 4,
        borderRadius: 12,
        backgroundColor: `${Colors.pageBg}33`,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {content}
    </View>
  );
}

export function GroupCardChip({
  membership,
  isSelected,
  onPress,
}: GroupCardChipProps): ReactNode {
  const gradient = GRADIENT_BY_STATUS[membership.status];
  // Apply 0.3 opacity overlay tone to match Swift (.opacity(0.3) is folded
  // into the gradient stops via the alpha suffix).
  const c0 = `${gradient[0]}4D`;
  const c1 = `${gradient[1]}4D`;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={membership.name}
      style={[
        styles.card,
        {
          transform: [{ scale: isSelected ? 1.05 : 1 }],
          borderColor: isSelected ? Colors.text1 : 'transparent',
        },
      ]}
    >
      <LinearGradient
        colors={[c0, c1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Abstract decor: two soft circles */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: -40,
          left: -40,
          width: 128,
          height: 128,
          borderRadius: 64,
          backgroundColor: `${Colors.text1}1A`,
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          bottom: -20,
          right: -30,
          width: 96,
          height: 96,
          borderRadius: 48,
          backgroundColor: `${Colors.text1}0D`,
        }}
      />

      <View style={styles.content}>
        <View style={styles.headerRow}>
          <View style={styles.iconChip}>
            <SfIcon name="person.3.fill" size={12} color={Colors.text1} />
          </View>
          <View style={{ flex: 1 }} />
          <StatusBadge status={membership.status} />
        </View>

        <View style={{ flex: 1 }} />

        <Text
          numberOfLines={2}
          style={{
            color: Colors.text1,
            fontSize: 12,
            fontFamily: MONO_FONT,
            fontWeight: '700',
          }}
        >
          {membership.name}
        </Text>
        <Text
          style={{
            color: `${Colors.text1}CC`,
            fontSize: 11,
            marginTop: 4,
          }}
        >
          {membership.memberIndex !== null
            ? `Member #${String(membership.memberIndex + 1)}`
            : 'Not a member'}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 160,
    height: 200,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 3,
    backgroundColor: Colors.cardBg,
    shadowColor: Colors.pageBg,
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  content: { flex: 1, padding: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  iconChip: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: `${Colors.text1}33`,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
