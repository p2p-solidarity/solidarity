/**
 * Color token parity — Swift `Color.Theme.*` ↔ TS `Colors.*`.
 *
 * Locks the brand palette so a future colour tweak in either codebase
 * fails the test if the other side falls out of sync. Only verifies
 * the **static hex tokens** (Swift `Color(hex: 0x…)`) — dynamic-provider
 * tokens (light + dark variants in one Swift `Color`) are not asserted
 * here because their TS equivalents use the `<name>` (light) and
 * `<name>Dark` split which doesn't need separate parity.
 *
 * Source of truth on the Swift side:
 *   solidarity/Services/Utils/ThemeManager.swift
 */
import { describe, expect, test } from 'bun:test';

import { Colors } from '@/constants/Colors';

interface ParityRow {
  readonly swiftName: string;
  readonly swiftHex: string;
  readonly tsToken: keyof typeof Colors;
}

const PARITY: readonly ParityRow[] = [
  { swiftName: 'Palette.ink',       swiftHex: '#2F2F30', tsToken: 'text1' },
  { swiftName: 'Palette.slate',     swiftHex: '#5F5E67', tsToken: 'text2' },
  { swiftName: 'Palette.stone',     swiftHex: '#9C9AA6', tsToken: 'text3' },
  { swiftName: 'Palette.fog',       swiftHex: '#D1D1D1', tsToken: 'divider' },
  { swiftName: 'Palette.mist',      swiftHex: '#EEEEEE', tsToken: 'searchBg' },
  { swiftName: 'Palette.cream',     swiftHex: '#FBF9F2', tsToken: 'pageBg' },
  { swiftName: 'Palette.paper',     swiftHex: '#FFFFFF', tsToken: 'cardBg' },
  { swiftName: 'Palette.purple',    swiftHex: '#83537D', tsToken: 'primaryMauve' },
  { swiftName: 'Palette.green',     swiftHex: '#4CAF51', tsToken: 'terminalGreen' },
  { swiftName: 'Palette.red',       swiftHex: '#CD556A', tsToken: 'destructive' },
  { swiftName: 'Theme.accentRose',  swiftHex: '#BF80A7', tsToken: 'accentRose' },
  { swiftName: 'Theme.dustyMauve',  swiftHex: '#A6678D', tsToken: 'dustyMauve' },
];

describe('Swift Color.Theme.* ↔ TS Colors parity', () => {
  for (const row of PARITY) {
    test(`${row.swiftName} (#${row.swiftHex.slice(1).toUpperCase()}) → Colors.${row.tsToken}`, () => {
      const tsValue = Colors[row.tsToken];
      expect(tsValue.toUpperCase()).toBe(row.swiftHex.toUpperCase());
    });
  }

  test('every parity row references an existing TS token', () => {
    for (const row of PARITY) {
      expect(Colors).toHaveProperty(row.tsToken);
    }
  });
});
