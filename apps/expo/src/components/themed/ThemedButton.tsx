/**
 * ThemedButton — single CTA primitive, 5 variants matching the Swift
 * Themed*ButtonStyle family:
 *   primary           → solid accentRose, contrast-safe foreground
 *   inverted          → white background, dark text (Swift ThemedInverted)
 *   secondary         → translucent border, accent text
 *   dottedOutline     → dashed border, accent text
 *   destructive       → red outline + red text
 *
 * Per aniseekr-expo CLAUDE.md rule 1: do NOT re-roll a per-screen
 * PrimaryButton. Extend variants here. The foreground colour for the
 * `primary` variant is computed via `readableTextOn` so a light accent
 * (gold, pale cyan) gets dark text instead of invisible white.
 *
 * Why no haptic wired here: `expo-haptics` import would force every
 * test to mock it. Callers pass `onPress` that does any haptic side
 * effect themselves; this matches aniseekr's later refactor.
 */
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  StyleSheet,
  View,
} from 'react-native';

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

// Swift accent is `accentRose` (#D8466B). The light/dark mode CSS vars in
// global.css don't redefine accentRose, so it's stable across modes; we
// can pin its hex here for the contrast calc.
const ACCENT_ROSE_HEX = '#D8466B';

const VARIANT_CONFIG: Readonly<Record<ButtonVariant, VariantStyle>> = {
  primary: {
    container: 'bg-accentRose',
    textColor: readableTextOn(ACCENT_ROSE_HEX),
  },
  inverted: {
    container: 'bg-cardBg border border-divider',
    textColor: ON_LIGHT,
  },
  secondary: {
    container: 'bg-transparent border border-divider',
    textColor: '', // resolved via tone="accent"
  },
  dottedOutline: {
    container: 'bg-transparent', // dashed border applied inline
    textColor: '',
  },
  destructive: {
    container: 'bg-transparent border border-destructive',
    textColor: '', // resolved via tone="error"
  },
};

export interface ThemedButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  readonly label: string;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly fullWidth?: boolean;
  readonly loading?: boolean;
  readonly leadingIcon?: ReactNode;
}

export function ThemedButton({
  label,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  leadingIcon,
  disabled,
  className,
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
      ? { borderStyle: 'dashed' as const, borderWidth: 1, borderColor: ACCENT_ROSE_HEX }
      : {}),
  };

  const inlineTextColor =
    variant === 'primary'
      ? { color: cfg.textColor }
      : variant === 'inverted'
        ? { color: ON_LIGHT }
        : undefined;

  return (
    <Pressable
      className={baseClass}
      style={containerStyle}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? ON_DARK : ACCENT_ROSE_HEX} />
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
