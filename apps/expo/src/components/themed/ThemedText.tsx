/**
 * ThemedText — primary text primitive. Maps tone (primary/secondary/tertiary/
 * accent/error) to theme tokens; variant (headlineLarge…caption) to the
 * Typography scale.
 *
 * Per CLAUDE.md rule 2: never use raw `<Text style={{ fontSize, fontWeight }}>`.
 * Use this component OR spread a Typography token from constants/.
 */
import type { ReactNode } from 'react';
import { Text, type TextProps, type TextStyle } from 'react-native';

export type TextTone = 'primary' | 'secondary' | 'tertiary' | 'accent' | 'error';

export type TextVariant =
  | 'headlineLarge'
  | 'headlineMedium'
  | 'titleLarge'
  | 'titleMedium'
  | 'bodyLarge'
  | 'bodyMedium'
  | 'bodySmall'
  | 'caption'
  | 'label';

const TONE_CLASS: Readonly<Record<TextTone, string>> = {
  primary: 'text-text1',
  secondary: 'text-text2',
  tertiary: 'text-text3',
  accent: 'text-accentRose',
  error: 'text-destructive',
};

const VARIANT_STYLE: Readonly<Record<TextVariant, TextStyle>> = {
  headlineLarge: { fontSize: 32, fontWeight: '700', lineHeight: 40 },
  headlineMedium: { fontSize: 24, fontWeight: '700', lineHeight: 32 },
  titleLarge: { fontSize: 20, fontWeight: '600', lineHeight: 28 },
  titleMedium: { fontSize: 17, fontWeight: '600', lineHeight: 24 },
  bodyLarge: { fontSize: 17, fontWeight: '400', lineHeight: 24 },
  bodyMedium: { fontSize: 15, fontWeight: '400', lineHeight: 22 },
  bodySmall: { fontSize: 13, fontWeight: '400', lineHeight: 18 },
  caption: { fontSize: 12, fontWeight: '500', lineHeight: 16 },
  label: { fontSize: 13, fontWeight: '600', lineHeight: 18 },
};

/** Fixed-width figures so live-updating numbers don't reflow their neighbours. */
const TABULAR_STYLE: TextStyle = { fontVariant: ['tabular-nums'] };

export interface ThemedTextProps extends Omit<TextProps, 'children'> {
  readonly variant?: TextVariant;
  readonly tone?: TextTone;
  /** Equal-width figures (`tabular-nums`) for numbers that update in place. */
  readonly tabularNums?: boolean;
  readonly children: ReactNode;
}

export function ThemedText({
  variant = 'bodyMedium',
  tone = 'primary',
  tabularNums = false,
  className,
  style,
  children,
  ...rest
}: ThemedTextProps): ReactNode {
  const tw = `${TONE_CLASS[tone]} ${className ?? ''}`.trim();
  return (
    <Text
      className={tw}
      style={[VARIANT_STYLE[variant], tabularNums ? TABULAR_STYLE : null, style]}
      {...rest}
    >
      {children}
    </Text>
  );
}
