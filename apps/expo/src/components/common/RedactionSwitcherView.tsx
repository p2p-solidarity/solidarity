/**
 * RedactionSwitcherView — 1:1 port of Swift RedactionSwitcherView.
 *
 * Selective-disclosure row used by VC presentation flows. Toggles between
 * showing the real value and a "[██████ REDACTED]" placeholder in
 * destructive red. Active state is enclosed in a searchBg block; inactive
 * state is transparent. Verified-seal icon appears when disclosed.
 *
 * Toggle uses a rectangular Neo-Brutalist switch (44×24 with 18×18
 * sliding thumb), terminalGreen when on, searchBg when off.
 */
import { Pressable, Text, View } from 'react-native';

import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';

export interface RedactionSwitcherViewProps {
  readonly label: string;
  readonly value: string;
  readonly isDisclosed: boolean;
  readonly onToggle: (next: boolean) => void;
}

export function RedactionSwitcherView({
  label,
  value,
  isDisclosed,
  onToggle,
}: RedactionSwitcherViewProps) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
        padding: 16,
        backgroundColor: isDisclosed ? Colors.searchBg : 'transparent',
        borderWidth: 1,
        borderColor: Colors.divider,
      }}
    >
      <Pressable
        onPress={() => {
          haptic('tap');
          onToggle(!isDisclosed);
        }}
        accessibilityRole="switch"
        accessibilityState={{ checked: isDisclosed }}
      >
        <View
          style={{
            width: 44,
            height: 24,
            backgroundColor: isDisclosed ? Colors.terminalGreen : Colors.searchBg,
            borderWidth: 1,
            borderColor: isDisclosed ? Colors.terminalGreen : Colors.divider,
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              width: 18,
              height: 18,
              backgroundColor: isDisclosed ? '#000' : Colors.text2,
              transform: [{ translateX: isDisclosed ? 22 : 3 }],
            }}
          />
        </View>
      </Pressable>

      <View style={{ flex: 1, gap: 4 }}>
        <Text
          style={{
            fontFamily: 'Menlo',
            fontSize: 11,
            fontWeight: '700',
            color: Colors.text3,
          }}
        >
          {label.toUpperCase()}
        </Text>
        {isDisclosed ? (
          <Text
            style={{
              fontSize: 16,
              fontWeight: '600',
              color: Colors.text1,
            }}
          >
            {value}
          </Text>
        ) : (
          <Text
            style={{
              fontFamily: 'Menlo',
              fontSize: 16,
              fontWeight: '900',
              color: Colors.destructive,
            }}
          >
            [██████ REDACTED]
          </Text>
        )}
      </View>

      {isDisclosed ? (
        <SfIcon name="checkmark.seal.fill" size={14} color={Colors.terminalGreen} />
      ) : null}
    </View>
  );
}
