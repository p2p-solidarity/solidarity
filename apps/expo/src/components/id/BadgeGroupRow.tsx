/**
 * BadgeGroupRow — port of Swift `groupRow(group:)` from
 * solidarity/Views/IDViews/IDViewHelpers.swift (section 3, "The Badge").
 *
 * Visual: 44pt accent-tinted circle + name (with "CloudKit" pill) + member
 * count + chevron.right. Used inside the dev-mode badge section.
 */
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';
import { ON_DARK, ThemedSurface, ThemedText } from '@/components/themed';

export interface BadgeGroupRowProps {
  readonly name: string;
  readonly memberCount: number;
  readonly providerLabel?: string;
  readonly onPress: () => void;
}

export function BadgeGroupRow({
  name,
  memberCount,
  providerLabel,
  onPress,
}: BadgeGroupRowProps): ReactNode {
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={name}>
      <ThemedSurface
        variant="card"
        className="rounded-none"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 16,
          padding: 12,
        }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: `${Colors.accentRose}26`,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <SfIcon name="person.3.fill" size={18} color={Colors.accentRose} />
        </View>

        <View style={{ flex: 1 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
            }}>
            <ThemedText variant="bodyMedium" numberOfLines={1}>
              {name}
            </ThemedText>
            {providerLabel ? (
              <View
                style={{
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  borderRadius: 8,
                  backgroundColor: `${Colors.primaryBlue}CC`,
                }}>
                <ThemedText variant="caption" style={{ color: ON_DARK }}>
                  {providerLabel}
                </ThemedText>
              </View>
            ) : null}
          </View>
          <ThemedText variant="caption" tone="secondary" className="mt-0.5">
            {`${String(memberCount)} ${memberCount === 1 ? 'member' : 'members'}`}
          </ThemedText>
        </View>

        <SfIcon name="chevron.right" size={12} weight="semibold" color={Colors.text3} />
      </ThemedSurface>
    </PressableScale>
  );
}
