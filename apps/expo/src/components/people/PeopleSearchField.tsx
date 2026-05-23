/**
 * PeopleSearchField — 1:1 port of Swift PeopleListView.searchField.
 * `magnifyingglass` (14pt) + TextField "Search" placeholder, 0.5pt
 * textPrimary border, 2pt corner radius.
 */
import { Text, TextInput, View } from 'react-native';

import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';

export function PeopleSearchField({
  value,
  onChangeText,
}: {
  value: string;
  onChangeText: (v: string) => void;
}) {
  return (
    <View
      className="flex-row items-center gap-2 rounded-sm2 px-3 py-2.5"
      style={{ borderWidth: 0.5, borderColor: Colors.text1 }}
    >
      <SfIcon name="magnifyingglass" size={14} color={Colors.text2} />
      <View className="flex-1">
        {value.length === 0 ? (
          <Text className="text-text2 text-[14px] absolute">Search</Text>
        ) : null}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          autoCapitalize="none"
          autoCorrect={false}
          className="text-text1 text-[14px]"
          style={{ padding: 0 }}
        />
      </View>
    </View>
  );
}
