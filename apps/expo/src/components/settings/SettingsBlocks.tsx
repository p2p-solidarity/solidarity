/**
 * SettingsBlock primitives — direct port of
 * solidarity/Views/Common/SettingsBlockComponents.swift so all six settings
 * screens look identical to Swift.
 *
 * Settings are a square, continuous list: card background, 0.5pt hairlines,
 * and no floating cards. That keeps the low-frequency routes visually aligned
 * with the Page tab without changing the routes or actions they expose.
 */
import type { SFSymbol } from 'expo-symbols';
import type { ReactNode } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';
import { useThemeColors } from '@/constants/useThemeColors';

// ─────────────────────────────────────────────────────────────────────────────
// Section header (14pt regular textPrimary, horiz pad 16)
// ─────────────────────────────────────────────────────────────────────────────

export function SettingsBlockSectionHeader({ title }: { title: string }) {
  return (
    <View className="px-4">
      <Text className="text-[14px] text-text1">{title}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Segmented control — mutually exclusive choice, matching the Appearance
// screen's colour-mode control so settings only ever teach one such shape.
// Used both for in-screen tabs and for small option sets (backup interval).
// ─────────────────────────────────────────────────────────────────────────────

export interface SettingsSegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

export function SettingsSegmented<T extends string>({
  value,
  options,
  onChange,
  role = 'button',
}: {
  value: T;
  options: readonly SettingsSegmentedOption<T>[];
  onChange: (value: T) => void;
  /** `'tab'` when the segments swap the screen's content, so VoiceOver
   *  announces them as tabs rather than as plain buttons. */
  role?: 'button' | 'tab';
}) {
  const c = useThemeColors();
  return (
    <View
      className="flex-row bg-mutedSurface"
      accessibilityRole={role === 'tab' ? 'tablist' : undefined}
      style={{ borderRadius: 12, padding: 4 }}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <PressableScale
            key={option.value}
            fill
            accessibilityRole={role}
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            onPress={() => { onChange(option.value); }}
            style={{
              minHeight: 44,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 8,
              backgroundColor: selected ? c.cardBg : 'transparent',
            }}>
            <Text
              className="text-[13px]"
              style={{
                color: selected ? c.text1 : c.text2,
                fontWeight: selected ? '600' : '400',
              }}>
              {option.label}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section container — header + continuous rows + optional footer
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
      <View className="mx-4 overflow-hidden rounded-none border border-divider bg-cardBg">
        {children}
      </View>
      {footer ? <Text className="px-4 text-[12px] text-text3">{footer}</Text> : null}
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
      className="flex-row items-center rounded-none border-b border-divider bg-cardBg"
      style={{
        paddingHorizontal: 14,
        paddingVertical: 14,
        opacity: disabled ? 0.5 : 1,
        borderBottomWidth: 0.5,
      }}>
      <View
        style={{
          width: 20,
          height: 20,
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: 12,
        }}>
        <SfIcon name={icon} size={14} color={resolvedIcon} />
      </View>

      <View className="flex-1">
        <Text className="text-[15px]" style={{ color: resolvedTitle }}>
          {title}
        </Text>
        {subtitle ? (
          <Text className="text-[12px] text-text3" style={{ marginTop: 2 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {trailingText ? (
        <Text className="text-[13px] text-text2" style={{ marginLeft: 12 }}>
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
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={title}>
      {content}
    </PressableScale>
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
      className="flex-row items-center rounded-none border-b border-divider bg-cardBg"
      style={{ paddingHorizontal: 14, paddingVertical: 14, borderBottomWidth: 0.5 }}>
      <View
        style={{
          width: 20,
          height: 20,
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: 12,
        }}>
        <SfIcon name={icon} size={14} color={Colors.destructive} />
      </View>
      <View className="flex-1">
        <Text className="text-[15px] text-destructive">{title}</Text>
        {subtitle ? (
          <Text className="text-[12px] text-text3" style={{ marginTop: 2 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );

  if (!onPress) return content;
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={title}>
      {content}
    </PressableScale>
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
  disabled = false,
}: {
  icon: SFSymbol;
  title: string;
  subtitle?: string;
  iconColor?: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const c = useThemeColors();
  return (
    <View
      className="flex-row items-center rounded-none border-b border-divider bg-cardBg"
      style={{
        paddingHorizontal: 14,
        paddingVertical: 12,
        opacity: disabled ? 0.5 : 1,
        borderBottomWidth: 0.5,
      }}>
      <View
        style={{
          width: 20,
          height: 20,
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: 12,
        }}>
        <SfIcon name={icon} size={14} color={iconColor ?? c.text1} />
      </View>
      <View className="flex-1">
        <Text className="text-[15px] text-text1">{title}</Text>
        {subtitle ? (
          <Text className="text-[12px] text-text3" style={{ marginTop: 2 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
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
      className="flex-row items-center rounded-none border-b border-divider bg-cardBg"
      style={{ paddingHorizontal: 14, paddingVertical: 14, borderBottomWidth: 0.5 }}>
      <View
        style={{
          width: 20,
          height: 20,
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: 12,
        }}>
        <SfIcon name={icon} size={14} color={iconColor ?? c.text1} />
      </View>
      <Text className="flex-1 text-[15px] text-text1">{title}</Text>
      <Text className="text-[13px] text-text2">{value}</Text>
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
    <View className="flex-row items-center" style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
      <PressableScale
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Back"
        className="flex-row items-center"
        style={{ paddingHorizontal: 4, paddingVertical: 8 }}>
        <SfIcon name="chevron.left" size={16} weight="semibold" color={c.text1} />
        <Text className="text-[16px] text-text1" style={{ marginLeft: 4 }}>
          {title}
        </Text>
      </PressableScale>
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
      }}>
      {leadingAction ? (
        <Pressable
          onPress={leadingAction.onPress}
          accessibilityRole="button"
          accessibilityLabel={leadingAction.accessibilityLabel}
          className="absolute items-center justify-center active:opacity-80"
          style={{ left: 8, top: 0, bottom: 0, width: 44 }}>
          <SfIcon
            name={leadingAction.icon ?? 'chevron.left'}
            size={22}
            weight="semibold"
            color={c.text1}
          />
        </Pressable>
      ) : null}
      <Text
        className="text-[17px] font-semibold text-text1"
        numberOfLines={1}
        style={{ maxWidth: '100%' }}>
        {title}
      </Text>
      {trailingAction ? (
        <Pressable
          onPress={trailingAction.onPress}
          accessibilityRole="button"
          accessibilityLabel={trailingAction.accessibilityLabel}
          className="absolute items-center justify-center active:opacity-80"
          style={{ right: 8, top: 0, bottom: 0, width: 44 }}>
          <SfIcon name={trailingAction.icon} size={22} color={c.text1} />
        </Pressable>
      ) : null}
    </View>
  );
}
