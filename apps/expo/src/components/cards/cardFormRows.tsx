/**
 * Row primitives shared by BusinessCardForm — mirror the visual contract of
 * Swift's SettingsBlock* family for the card editor:
 *   • FieldRow / NameField  → 14pt SF icon (20×20 frame) + 15pt TextInput
 *   • ToggleRow             → icon + 15pt label + Switch (primaryBlue)
 *   • FormatRow             → icon + 15pt label + trailing 13pt value (taps cycle)
 *   • DangerRow             → destructive icon + destructive 15pt label
 * Background: `mutedSurface` with corner radius 12, padded 14×12.
 */
import { type SFSymbol } from 'expo-symbols';
import {
  Pressable,
  Switch,
  Text,
  TextInput,
  type KeyboardTypeOptions,
  type TextInputProps,
  View,
} from 'react-native';

import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';

export const ROW_STYLES = {
  container: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.mutedSurface,
  },
  iconBox: {
    width: 20,
    height: 20,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
};

export interface FieldRowProps {
  readonly icon: SFSymbol;
  readonly placeholder: string;
  readonly value: string;
  readonly onChangeText: (text: string) => void;
  readonly keyboardType?: KeyboardTypeOptions;
  readonly autoCapitalize?: TextInputProps['autoCapitalize'];
}

export function FieldRow({
  icon,
  placeholder,
  value,
  onChangeText,
  keyboardType = 'default',
  autoCapitalize = 'sentences',
}: FieldRowProps) {
  return (
    <View style={ROW_STYLES.container}>
      <View style={ROW_STYLES.iconBox}>
        <SfIcon name={icon} size={14} color={Colors.text1} />
      </View>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.text3}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        style={{ flex: 1, fontSize: 15, color: Colors.text1, padding: 0 }}
      />
    </View>
  );
}

export function NameField({
  value,
  onChange,
  trimmed,
}: {
  value: string;
  onChange: (text: string) => void;
  trimmed: string;
}) {
  return (
    <View style={ROW_STYLES.container}>
      <View style={ROW_STYLES.iconBox}>
        <SfIcon name="person" size={14} color={Colors.text1} />
      </View>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="Name"
        placeholderTextColor={Colors.text3}
        style={{ flex: 1, fontSize: 15, color: Colors.text1, padding: 0 }}
      />
      {trimmed.length === 0 ? (
        <Text style={{ fontSize: 15, fontWeight: '600', color: Colors.destructive }}>*</Text>
      ) : null}
    </View>
  );
}

export function ToggleRow({
  icon,
  title,
  value,
  onChange,
}: {
  icon: SFSymbol;
  title: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <View style={[ROW_STYLES.container, { paddingVertical: 10 }]}>
      <View style={ROW_STYLES.iconBox}>
        <SfIcon name={icon} size={14} color={Colors.text1} />
      </View>
      <Text className="text-[15px] text-text1" style={{ flex: 1 }}>
        {title}
      </Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: Colors.primaryBlue, false: undefined }}
      />
    </View>
  );
}

export function FormatRow({ trailing, onPress }: { trailing: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Sharing format"
      accessibilityValue={{ text: trailing }}
      style={ROW_STYLES.container}>
      <View style={ROW_STYLES.iconBox}>
        <SfIcon name="square.and.arrow.up.on.square" size={14} color={Colors.text1} />
      </View>
      <Text className="text-[15px] text-text1" style={{ flex: 1 }}>
        Sharing format
      </Text>
      <Text className="text-[13px] text-text2">{trailing}</Text>
    </Pressable>
  );
}

export function DangerRow({
  icon,
  title,
  onPress,
}: {
  icon: SFSymbol;
  title: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={[ROW_STYLES.container, { paddingVertical: 14 }]}>
      <View style={ROW_STYLES.iconBox}>
        <SfIcon name={icon} size={14} color={Colors.destructive} />
      </View>
      <Text style={{ fontSize: 15, color: Colors.destructive, flex: 1 }}>{title}</Text>
    </Pressable>
  );
}

export function SectionHeader({ title }: { title: string }) {
  return (
    <View style={{ paddingHorizontal: 16 }}>
      <Text className="text-[14px] text-text1">{title}</Text>
    </View>
  );
}
