/**
 * SettingsBlock primitives — direct port of
 * solidarity/Views/Common/SettingsBlockComponents.swift so all six settings
 * screens look identical to Swift.
 *
 * Each row is its own 12pt rounded card on `mutedSurface`, stacked with
 * 8pt spacing. Section header is 14pt textPrimary, footer 12pt textTertiary,
 * both horiz pad 16. Rows are also horiz pad 16 (8pt outer = 16+0 = inner).
 */
import type { SFSymbol } from 'expo-symbols';
import type { ReactNode } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';

import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';
import { useThemeColors } from '@/constants/useThemeColors';

// ─────────────────────────────────────────────────────────────────────────────
// Section header (14pt regular textPrimary, horiz pad 16)
// ─────────────────────────────────────────────────────────────────────────────

export function SettingsBlockSectionHeader({ title }: { title: string }) {
  return (
    <View className="px-4">
      <Text className="text-text1 text-[14px]">{title}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section container — header + 8pt-spaced rows + optional footer
// ─────────────────────────────────────────────────────────────────────────────

export function SettingsBlockSection({
  title,
  footer,
  children,
}: {
  title: string;
  footer?: string;
  children: ReactNode;
}) {
  return (
    <View className="gap-2">
      <SettingsBlockSectionHeader title={title} />
      <View className="px-4 gap-2">{children}</View>
      {footer ? (
        <Text className="px-4 text-text3 text-[12px]">{footer}</Text>
      ) : null}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Standard row — icon + title + (subtitle) + (trailing text) + (chevron)
// ─────────────────────────────────────────────────────────────────────────────

export interface SettingsBlockRowProps {
  icon: SFSymbol;
  title: string;
  subtitle?: string;
  trailingText?: string;
  showsChevron?: boolean;
  iconColor?: string;
  titleColor?: string;
  onPress?: () => void;
  disabled?: boolean;
}

export function SettingsBlockRow({
  icon,
  title,
  subtitle,
  trailingText,
  showsChevron = true,
  iconColor,
  titleColor,
  onPress,
  disabled = false,
}: SettingsBlockRowProps) {
  const c = useThemeColors();
  const resolvedIcon = iconColor ?? c.text1;
  const resolvedTitle = titleColor ?? c.text1;
  const content = (
    <View
      className="bg-mutedSurface rounded-xl flex-row items-center"
      style={{ paddingHorizontal: 14, paddingVertical: 14, opacity: disabled ? 0.5 : 1 }}
    >
      <View
        style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}
      >
        <SfIcon name={icon} size={14} color={resolvedIcon} />
      </View>

      <View className="flex-1">
        <Text className="text-[15px]" style={{ color: resolvedTitle }}>
          {title}
        </Text>
        {subtitle ? (
          <Text className="text-text3 text-[12px]" style={{ marginTop: 2 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {trailingText ? (
        <Text
          className="text-text2 text-[13px]"
          style={{ marginLeft: 12 }}
        >
          {trailingText}
        </Text>
      ) : null}

      {showsChevron ? (
        <View style={{ marginLeft: 12 }}>
          <SfIcon name="chevron.right" size={12} weight="semibold" color={c.text3} />
        </View>
      ) : null}
    </View>
  );

  if (!onPress || disabled) {
    return content;
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      className="active:opacity-80"
    >
      {content}
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Danger row — destructive accent on icon + title, no chevron
// ─────────────────────────────────────────────────────────────────────────────

export function SettingsBlockDangerRow({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: SFSymbol;
  title: string;
  subtitle?: string;
  onPress?: () => void;
}) {
  const content = (
    <View
      className="bg-mutedSurface rounded-xl flex-row items-center"
      style={{ paddingHorizontal: 14, paddingVertical: 14 }}
    >
      <View
        style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}
      >
        <SfIcon name={icon} size={14} color={Colors.destructive} />
      </View>
      <View className="flex-1">
        <Text className="text-destructive text-[15px]">{title}</Text>
        {subtitle ? (
          <Text className="text-text3 text-[12px]" style={{ marginTop: 2 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );

  if (!onPress) return content;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      className="active:opacity-80"
    >
      {content}
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Toggle row — icon + label + (subtitle) + Switch
// ─────────────────────────────────────────────────────────────────────────────

export function SettingsBlockToggleRow({
  icon,
  title,
  subtitle,
  iconColor,
  value,
  onValueChange,
}: {
  icon: SFSymbol;
  title: string;
  subtitle?: string;
  iconColor?: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
}) {
  const c = useThemeColors();
  return (
    <View
      className="bg-mutedSurface rounded-xl flex-row items-center"
      style={{ paddingHorizontal: 14, paddingVertical: 12 }}
    >
      <View
        style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}
      >
        <SfIcon name={icon} size={14} color={iconColor ?? c.text1} />
      </View>
      <View className="flex-1">
        <Text className="text-text1 text-[15px]">{title}</Text>
        {subtitle ? (
          <Text className="text-text3 text-[12px]" style={{ marginTop: 2 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: c.divider, true: Colors.primaryBlue }}
        thumbColor={c.cardBg}
        ios_backgroundColor={c.divider}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Info row — icon + label + read-only value (textSecondary, 13pt)
// ─────────────────────────────────────────────────────────────────────────────

export function SettingsBlockInfoRow({
  icon,
  title,
  value,
  iconColor,
}: {
  icon: SFSymbol;
  title: string;
  value: string;
  iconColor?: string;
}) {
  const c = useThemeColors();
  return (
    <View
      className="bg-mutedSurface rounded-xl flex-row items-center"
      style={{ paddingHorizontal: 14, paddingVertical: 14 }}
    >
      <View
        style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}
      >
        <SfIcon name={icon} size={14} color={iconColor ?? c.text1} />
      </View>
      <Text className="text-text1 text-[15px] flex-1">{title}</Text>
      <Text className="text-text2 text-[13px]">{value}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Screen back toolbar — chevron.left + "Done" (or custom title), 16pt
// ─────────────────────────────────────────────────────────────────────────────

export function SettingsBackToolbar({
  title = 'Settings',
  onPress,
}: {
  title?: string;
  onPress: () => void;
}) {
  const c = useThemeColors();
  return (
    <View
      className="flex-row items-center"
      style={{ paddingHorizontal: 12, paddingVertical: 10 }}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Back"
        className="flex-row items-center active:opacity-80"
        style={{ paddingHorizontal: 4, paddingVertical: 8 }}
      >
        <SfIcon name="chevron.left" size={16} weight="semibold" color={c.text1} />
        <Text className="text-text1 text-[16px]" style={{ marginLeft: 4 }}>
          {title}
        </Text>
      </Pressable>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Screen title — inline nav title (17pt semibold textPrimary, centered).
// Optional leading/trailing actions render pinned 44×44 icon buttons on the
// same row so the title stays optically centered.
// ─────────────────────────────────────────────────────────────────────────────

export interface SettingsScreenTitleLeadingAction {
  icon?: SFSymbol;
  accessibilityLabel: string;
  onPress: () => void;
}

export interface SettingsScreenTitleTrailingAction {
  icon: SFSymbol;
  accessibilityLabel: string;
  onPress: () => void;
}

export function SettingsScreenTitle({
  title,
  leadingAction,
  trailingAction,
}: {
  title: string;
  leadingAction?: SettingsScreenTitleLeadingAction;
  trailingAction?: SettingsScreenTitleTrailingAction;
}) {
  const c = useThemeColors();
  const hasNavAction = leadingAction != null || trailingAction != null;
  return (
    <View
      className="items-center justify-center"
      style={{
        paddingHorizontal: hasNavAction ? 56 : 0,
        paddingVertical: 4,
        paddingBottom: 12,
        minHeight: hasNavAction ? 44 : undefined,
      }}
    >
      {leadingAction ? (
        <Pressable
          onPress={leadingAction.onPress}
          accessibilityRole="button"
          accessibilityLabel={leadingAction.accessibilityLabel}
          className="absolute items-center justify-center active:opacity-80"
          style={{ left: 8, top: 0, bottom: 0, width: 44 }}
        >
          <SfIcon name={leadingAction.icon ?? 'chevron.left'} size={22} weight="semibold" color={c.text1} />
        </Pressable>
      ) : null}
      <Text
        className="text-text1 text-[17px] font-semibold"
        numberOfLines={1}
        style={{ maxWidth: '100%' }}
      >
        {title}
      </Text>
      {trailingAction ? (
        <Pressable
          onPress={trailingAction.onPress}
          accessibilityRole="button"
          accessibilityLabel={trailingAction.accessibilityLabel}
          className="absolute items-center justify-center active:opacity-80"
          style={{ right: 8, top: 0, bottom: 0, width: 44 }}
        >
          <SfIcon name={trailingAction.icon} size={22} color={c.text1} />
        </Pressable>
      ) : null}
    </View>
  );
}
