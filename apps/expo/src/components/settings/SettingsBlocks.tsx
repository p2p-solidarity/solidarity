/**
 * SettingsBlock primitives — direct port of
 * solidarity/Views/Common/SettingsBlockComponents.swift so all six settings
 * screens look identical to Swift.
 *
 * Settings are a square, continuous list: card background, 0.5pt hairlines,
 * and no floating cards. That keeps the low-frequency routes visually aligned
 * with the Page tab without changing the routes or actions they expose.
 *
 * Copy budget: a section gets at most ONE short footer line. Anything longer
 * goes behind an ⓘ passed as the header `accessory` (`InfoButton`), unless
 * the user needs it to act safely — then it stays on screen, shortened.
 */
import type { SFSymbol } from 'expo-symbols';
import type { ReactNode } from 'react';
import { Switch, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';
import { useThemeColors } from '@/constants/useThemeColors';
import { fadeUpIn, SCALE } from '@/feedback/motion';

// ─────────────────────────────────────────────────────────────────────────────
// Entrance — sections fade up in a 40 ms cascade the first time they mount.
// Reanimated `entering` only runs on mount, so a re-render never replays it.
// Reduced motion keeps the fade and drops the rise.
// ─────────────────────────────────────────────────────────────────────────────

export function SettingsEnter({
  index,
  style,
  children,
}: {
  index: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <Animated.View entering={fadeUpIn(index, reduceMotion)} style={style}>
      {children}
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section header (14pt regular textPrimary, horiz pad 16) + optional ⓘ
// ─────────────────────────────────────────────────────────────────────────────

export function SettingsBlockSectionHeader({
  title,
  accessory,
}: {
  title: string;
  /** Trailing control beside the title — typically an `InfoButton`. */
  accessory?: ReactNode;
}) {
  return (
    <View className="flex-row items-center px-4" style={{ gap: 6 }}>
      <Text className="text-[14px] text-text1">{title}</Text>
      {accessory}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section container — header + continuous rows + optional footer
// ─────────────────────────────────────────────────────────────────────────────

export function SettingsBlockSection({
  title,
  footer,
  accessory,
  index,
  children,
}: {
  title: string;
  /** One short line. Longer context belongs in `accessory` (an ⓘ). */
  footer?: string;
  accessory?: ReactNode;
  /** Position in the screen's entrance cascade; omit for no entrance. */
  index?: number;
  children: ReactNode;
}) {
  const body = (
    <>
      <SettingsBlockSectionHeader title={title} accessory={accessory} />
      <View className="mx-4 overflow-hidden rounded-none border border-divider bg-cardBg">
        {children}
      </View>
      {footer ? <Text className="px-4 text-[12px] text-text3">{footer}</Text> : null}
    </>
  );
  if (index === undefined) return <View className="gap-2">{body}</View>;
  return (
    <SettingsEnter index={index} style={{ gap: 8 }}>
      {body}
    </SettingsEnter>
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
        <PressableScale
          onPress={leadingAction.onPress}
          scaleTo={SCALE.icon}
          accessibilityRole="button"
          accessibilityLabel={leadingAction.accessibilityLabel}
          containerStyle={{ position: 'absolute', left: 8, top: 0, bottom: 0, width: 44 }}
          style={NAV_ACTION_HIT}>
          <SfIcon
            name={leadingAction.icon ?? 'chevron.left'}
            size={22}
            weight="semibold"
            color={c.text1}
          />
        </PressableScale>
      ) : null}
      <Text
        className="text-[17px] font-semibold text-text1"
        numberOfLines={1}
        style={{ maxWidth: '100%' }}>
        {title}
      </Text>
      {trailingAction ? (
        <PressableScale
          onPress={trailingAction.onPress}
          scaleTo={SCALE.icon}
          accessibilityRole="button"
          accessibilityLabel={trailingAction.accessibilityLabel}
          containerStyle={{ position: 'absolute', right: 8, top: 0, bottom: 0, width: 44 }}
          style={NAV_ACTION_HIT}>
          <SfIcon name={trailingAction.icon} size={22} color={c.text1} />
        </PressableScale>
      ) : null}
    </View>
  );
}

/** Fills the pinned 44pt column so the whole column is the touch target. */
const NAV_ACTION_HIT: ViewStyle = { flex: 1, alignItems: 'center', justifyContent: 'center' };
