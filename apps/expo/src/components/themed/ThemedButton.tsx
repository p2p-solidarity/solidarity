/**
 * ThemedButton — single CTA primitive, 5 variants matching
 * solidarity/Views/Common/ThemedButtonStyles.swift verbatim.
 *
 *   primary       → bg=textPrimary (ink), fg=pageBg, 1pt 30% textPrimary stroke
 *   inverted      → bg=white, fg=black, NO border
 *   secondary     → bg=cardSurface, fg=textPrimary, 1pt divider stroke
 *   dottedOutline → bg=clear, fg=primaryBlue, dashed primaryBlue stroke
 *   destructive   → bg=clear, fg=destructive, 1pt destructive stroke
 *
 * Every variant uses `clipShape(Rectangle())` → SQUARE corners (no borderRadius).
 * Font is 16pt medium (primary/inverted/destructive) or 16pt regular
 * (secondary/dottedOutline). 24h/14v padding. Pressed scale = 0.98.
 *
 * Haptic policy (aniseekr CLAUDE rule 7):
 *   primary/inverted/destructive → heavyImpact (Swift)
 *   secondary/dottedOutline      → rigidImpact / tap
 * Override with `haptic="…"` or `haptic={false}`.
 */
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { Colors } from '@/constants/Colors';
import { haptic as fireHaptic, type HapticKind } from '@/feedback/haptics';

export type ButtonVariant =
  | 'primary'
  | 'inverted'
  | 'secondary'
  | 'dottedOutline'
  | 'destructive';

export type ButtonSize = 'sm' | 'md' | 'lg';

/** Vertical padding per Swift (.padding(.vertical, 14)). Height = padding * 2 + line. */
const SIZE_PADDING_Y: Readonly<Record<ButtonSize, number>> = {
  sm: 10,
  md: 14,
  lg: 18,
};
/** Horizontal padding per Swift (.padding(.horizontal, 24)). */
const SIZE_PADDING_X: Readonly<Record<ButtonSize, number>> = {
  sm: 16,
  md: 24,
  lg: 28,
};

interface VariantStyle {
  readonly bg: string;
  readonly fg: string;
  readonly borderColor?: string;
  readonly borderWidth: number;
  readonly dashed?: boolean;
  /** Swift font weight per variant. */
  readonly weight: '400' | '500';
}

const VARIANT_CONFIG: Readonly<Record<ButtonVariant, VariantStyle>> = {
  primary: {
    bg: Colors.text1,                         // textPrimary
    fg: Colors.pageBg,                        // cream/ink-inverse
    borderColor: `${Colors.text1}4D`,         // textPrimary @ 30%
    borderWidth: 1,
    weight: '500',
  },
  inverted: {
    bg: '#FFFFFF',                            // pure white per Swift
    fg: '#000000',                            // pure black per Swift
    borderWidth: 0,                           // NO border
    weight: '500',
  },
  secondary: {
    bg: Colors.cardBg,                        // cardSurface
    fg: Colors.text1,                         // textPrimary
    borderColor: Colors.divider,
    borderWidth: 1,
    weight: '400',                            // regular
  },
  dottedOutline: {
    bg: 'transparent',
    fg: Colors.primaryBlue,
    borderColor: Colors.primaryBlue,
    borderWidth: 1,
    dashed: true,
    weight: '400',
  },
  destructive: {
    bg: 'transparent',
    fg: Colors.destructive,
    borderColor: Colors.destructive,
    borderWidth: 1,
    weight: '500',
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
  className: _className,
  onPress,
  ...rest
}: ThemedButtonProps): ReactNode {
  const cfg = VARIANT_CONFIG[variant];
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const handlePressIn = () => {
    scale.value = withSpring(0.98, { damping: 100, stiffness: 600 });
  };
  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 100, stiffness: 600 });
  };

  const handlePress = (e: GestureResponderEvent) => {
    if (haptic !== false) fireHaptic(haptic ?? DEFAULT_HAPTIC[variant]);
    onPress?.(e);
  };

  // Swift uses `.clipShape(Rectangle())` — square corners on every variant.
  const containerStyle = {
    backgroundColor: cfg.bg,
    paddingHorizontal: SIZE_PADDING_X[size],
    paddingVertical: SIZE_PADDING_Y[size],
    borderWidth: cfg.borderWidth,
    borderColor: cfg.borderColor,
    borderStyle: cfg.dashed ? ('dashed' as const) : ('solid' as const),
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    flexDirection: 'row' as const,
    alignSelf: fullWidth ? ('stretch' as const) : ('flex-start' as const),
    opacity: disabled || loading ? 0.5 : 1,
  };

  return (
    <Animated.View style={[animStyle, fullWidth ? styles.fullWidth : undefined]}>
      <Pressable
        style={containerStyle}
        disabled={disabled || loading}
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        {...rest}
      >
        {loading ? (
          <ActivityIndicator color={cfg.fg} />
        ) : (
          <>
            {leadingIcon ? <View style={styles.icon}>{leadingIcon}</View> : null}
            <Text style={{ color: cfg.fg, fontSize: 16, fontWeight: cfg.weight }}>{label}</Text>
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fullWidth: { alignSelf: 'stretch' },
  icon: { marginRight: 8 },
});
