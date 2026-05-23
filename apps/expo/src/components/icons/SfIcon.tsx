/**
 * SfIcon — thin wrapper around expo-symbols' SymbolView so all icon use in
 * the app references SF Symbols by their Swift name (`gearshape`, `key`,
 * `chevron.right`, etc.), keeping naming verbatim with the SwiftUI legacy.
 *
 * Android fallback renders a 1-letter glyph derived from the symbol name —
 * placeholder until the migration adds the matching Material symbols.
 */
import { SymbolView, type SFSymbol } from 'expo-symbols';
import type { ColorValue } from 'react-native';
import { Platform, Text, View } from 'react-native';

export type SfIconProps = {
  /** SF Symbol name, e.g. `gearshape`, `chevron.right`. */
  name: SFSymbol;
  /** Symbol size in points. SwiftUI default for body text is 17. */
  size?: number;
  /** Tint colour. Defaults to inherit. */
  color?: ColorValue;
  /** Symbol weight (regular/medium/semibold/bold). */
  weight?: 'ultraLight' | 'thin' | 'light' | 'regular' | 'medium' | 'semibold' | 'bold' | 'heavy' | 'black';
};

export function SfIcon({
  name,
  size = 17,
  color,
  weight = 'regular',
}: SfIconProps) {
  if (Platform.OS === 'ios') {
    return (
      <SymbolView
        name={name}
        size={size}
        tintColor={color}
        weight={weight}
        resizeMode="scaleAspectFit"
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontSize: size * 0.8, color: color ?? '#000' }}>
        {fallbackGlyph(name)}
      </Text>
    </View>
  );
}

function fallbackGlyph(name: string): string {
  switch (name) {
    case 'chevron.right': return '›';
    case 'chevron.left':  return '‹';
    case 'chevron.up':    return '˄';
    case 'chevron.down':  return '˅';
    case 'xmark':         return '×';
    case 'plus':          return '+';
    case 'magnifyingglass': return '⌕';
    case 'gearshape':     return '⚙';
    case 'key':           return '⚷';
    case 'checkmark.seal.fill': return '✓';
    case 'faceid':        return '◐';
    default:              return '•';
  }
}
