import type { SFSymbol } from 'expo-symbols';
import type { TFunction } from 'i18next';
import { type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';
import type { BusinessCardField } from '@solidarity/shared';

export type VcStatus = 'verified' | 'selfAttested' | 'unverified';

export interface FieldDescriptor {
  readonly key: BusinessCardField;
  readonly icon: SFSymbol;
  readonly label: string;
  readonly locked?: boolean;
  readonly excludedFromVc?: boolean;
}

export const STATUS_COLOR: Readonly<Record<VcStatus, string>> = {
  verified: Colors.terminalGreen,
  selfAttested: Colors.warning,
  unverified: Colors.text3,
};

export function vcStatusLabel(
  status: VcStatus,
  excludedFromVc: boolean,
  t: TFunction,
): string {
  if (excludedFromVc) return t('shareSettings.status.sharedUnverified');
  if (status === 'verified') return t('shareSettings.status.verified');
  if (status === 'selfAttested') return t('shareSettings.status.selfDeclared');
  return t('shareSettings.status.unverified');
}

export function FieldRow({
  descriptor,
  isOn,
  verifiedFields,
  onToggle,
}: {
  readonly descriptor: FieldDescriptor;
  readonly isOn: boolean;
  readonly verifiedFields: ReadonlySet<BusinessCardField>;
  readonly onToggle: () => void;
}): ReactNode {
  const { t } = useTranslation();
  const status: VcStatus = descriptor.excludedFromVc
    ? 'unverified'
    : verifiedFields.has(descriptor.key)
      ? 'verified'
      : 'selfAttested';
  const statusColor = STATUS_COLOR[status];
  const statusLabel = vcStatusLabel(status, descriptor.excludedFromVc ?? false, t);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={descriptor.label}
      accessibilityState={{ selected: isOn, disabled: descriptor.locked }}
      onPress={onToggle}
      className="flex-row items-center"
      style={{
        backgroundColor: Colors.searchBg,
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 12,
      }}
    >
      <View style={{ width: 20, alignItems: 'center' }}>
        <SfIcon
          name={descriptor.icon}
          size={14}
          color={isOn ? statusColor : Colors.text3}
        />
      </View>
      <View style={{ flex: 1 }}>
        <ThemedText
          variant="label"
          tone={isOn ? 'primary' : 'secondary'}
          style={{ fontWeight: '500' }}
        >
          {descriptor.label}
        </ThemedText>
        {isOn ? (
          <ThemedText
            style={{
              color: statusColor,
              fontFamily: 'Menlo',
              fontSize: 10,
              fontWeight: '500',
              marginTop: 2,
            }}
          >
            {statusLabel}
          </ThemedText>
        ) : null}
      </View>
      {descriptor.locked ? (
        <SfIcon name="lock.fill" size={12} color={Colors.text3} />
      ) : (
        <SfIcon
          name={isOn ? 'checkmark.square.fill' : 'square'}
          size={18}
          color={isOn ? statusColor : Colors.text3}
        />
      )}
    </Pressable>
  );
}

export function ProofRow({
  icon,
  label,
  badge,
  badgeColor,
  isOn,
  locked = false,
  onToggle,
}: {
  readonly icon: SFSymbol;
  readonly label: string;
  readonly badge: string;
  readonly badgeColor: string;
  readonly isOn: boolean;
  readonly locked?: boolean;
  readonly onToggle: () => void;
}): ReactNode {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: isOn, disabled: locked }}
      onPress={() => {
        if (locked) return;
        onToggle();
      }}
      className="flex-row items-center"
      style={{
        backgroundColor: Colors.searchBg,
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 12,
      }}
    >
      <View style={{ width: 20, alignItems: 'center' }}>
        <SfIcon
          name={icon}
          size={14}
          color={isOn ? badgeColor : Colors.text3}
        />
      </View>
      <View style={{ flex: 1 }}>
        <ThemedText
          variant="label"
          tone={isOn ? 'primary' : 'secondary'}
          style={{ fontWeight: '500' }}
        >
          {label}
        </ThemedText>
        <ThemedText
          style={{
            color: badgeColor,
            fontFamily: 'Menlo',
            fontSize: 10,
            fontWeight: '700',
            marginTop: 2,
          }}
        >
          {badge}
        </ThemedText>
      </View>
      {locked ? (
        <SfIcon name="lock.fill" size={12} color={Colors.text3} />
      ) : (
        <SfIcon
          name={isOn ? 'checkmark.square.fill' : 'square'}
          size={18}
          color={isOn ? badgeColor : Colors.text3}
        />
      )}
    </Pressable>
  );
}

export function LegendItem({
  color,
  label,
}: {
  readonly color: string;
  readonly label: string;
}): ReactNode {
  return (
    <View className="flex-row items-center" style={{ gap: 4 }}>
      <View
        style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }}
      />
      <ThemedText
        tone="tertiary"
        style={{ fontFamily: 'Menlo', fontSize: 10 }}
      >
        {label}
      </ThemedText>
    </View>
  );
}
