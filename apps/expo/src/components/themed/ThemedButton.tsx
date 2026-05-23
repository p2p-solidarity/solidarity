/**
 * ThemedButton — single CTA primitive, 5 variants matching the Swift
 * Themed*ButtonStyle family + auto-haptic per aniseekr-expo CLAUDE rule 7:
 *   primary           → solid accentRose, contrast-safe foreground
 *   inverted          → white background, dark text (Swift ThemedInverted)
 *   secondary         → translucent border, accent text
 *   dottedOutline     → dashed border, accent text
 *   destructive       → red outline + red text
 *
 * Haptic policy (rule 7):
 *   primary           → success
 *   destructive       → warning
 *   * (default)       → tap
 * Override with `haptic="…"` or `haptic={false}` to disable.
 */
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  StyleSheet,
  View,
} from 'react-native';

import { Colors } from '@/constants/Colors';
import { haptic as fireHaptic, type HapticKind } from '@/feedback/haptics';

import { ON_DARK, ON_LIGHT, readableTextOn } from './contrast';
import { ThemedText, type TextVariant } from './ThemedText';

export type ButtonVariant =
  | 'primary'
  | 'inverted'
  | 'secondary'
  | 'dottedOutline'
  | 'destructive';

export type ButtonSize = 'sm' | 'md' | 'lg';

const SIZE_HEIGHT: Readonly<Record<ButtonSize, number>> = {
  sm: 36,
  md: 44,
  lg: 52,
};
const SIZE_PADDING_X: Readonly<Record<ButtonSize, number>> = {
  sm: 12,
  md: 16,
  lg: 20,
};
const SIZE_TEXT_VARIANT: Readonly<Record<ButtonSize, TextVariant>> = {
  sm: 'label',
  md: 'titleMedium',
  lg: 'titleLarge',
};

interface VariantStyle {
  readonly container: string;
  readonly textColor: string;
}

const VARIANT_CONFIG: Readonly<Record<ButtonVariant, VariantStyle>> = {
  primary: {
    container: 'bg-accentRose',
    textColor: readableTextOn(Colors.accentRose),
  },
  inverted: {
    container: 'bg-cardBg border border-divider',
    textColor: ON_LIGHT,
  },
  secondary: {
    container: 'bg-transparent border border-divider',
    textColor: '',
  },
  dottedOutline: {
    container: 'bg-transparent',
    textColor: '',
  },
  destructive: {
    container: 'bg-transparent border border-destructive',
    textColor: '',
  },
};

const DEFAULT_HAPTIC: Readonly<Record<ButtonVariant, HapticKind>> = {
  primary: 'success',
  inverted: 'tap',
  secondary: 'tap',
  dottedOutline: 'tap',
  destructive: 'warning',
};

export interface ThemedButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  readonly label: string;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly fullWidth?: boolean;
  readonly loading?: boolean;
  readonly leadingIcon?: ReactNode;
  /** Override the default haptic, or pass `false` to disable. */
  readonly haptic?: HapticKind | false;
}

export function ThemedButton({
  label,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  leadingIcon,
  haptic,
  disabled,
  className,
  onPress,
  ...rest
}: ThemedButtonProps): ReactNode {
  const cfg = VARIANT_CONFIG[variant];
  const minHeight = SIZE_HEIGHT[size];
  const isDashed = variant === 'dottedOutline';

  const baseClass = [
    cfg.container,
    'flex-row items-center justify-center rounded-2xl',
    fullWidth ? 'self-stretch' : 'self-start',
    disabled || loading ? 'opacity-50' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')
    .trim();

  const containerStyle = {
    minHeight,
    paddingHorizontal: SIZE_PADDING_X[size],
    ...(isDashed
      ? { borderStyle: 'dashed' as const, borderWidth: 1, borderColor: Colors.accentRose }
      : {}),
  };

  const inlineTextColor =
    variant === 'primary'
      ? { color: cfg.textColor }
      : variant === 'inverted'
        ? { color: ON_LIGHT }
        : undefined;

  const handlePress = (e: GestureResponderEvent) => {
    if (haptic !== false) fireHaptic(haptic ?? DEFAULT_HAPTIC[variant]);
    onPress?.(e);
  };

  return (
    <Pressable
      className={baseClass}
      style={containerStyle}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={handlePress}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? ON_DARK : Colors.accentRose} />
      ) : (
        <View style={styles.row}>
          {leadingIcon ? <View style={styles.icon}>{leadingIcon}</View> : null}
          <ThemedText
            variant={SIZE_TEXT_VARIANT[size]}
            tone={
              variant === 'destructive'
                ? 'error'
                : variant === 'secondary' || variant === 'dottedOutline'
                  ? 'accent'
                  : 'primary'
            }
            style={inlineTextColor}
          >
            {label}
          </ThemedText>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  icon: { marginRight: 8 },
});
