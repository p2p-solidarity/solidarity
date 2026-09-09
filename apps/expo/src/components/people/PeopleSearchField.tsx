/**
 * PeopleSearchField — 1:1 port of Swift PeopleListView.searchField.
 * `magnifyingglass` (14pt) + TextField "Search" placeholder, 0.5pt
 * textPrimary border, 2pt corner radius.
 */
import { TextInput } from 'react-native';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedSurface } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';

export function PeopleSearchField({
  value,
  onChangeText,
}: {
  value: string;
  onChangeText: (v: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <ThemedSurface
      variant="inset"
      className="flex-row items-center gap-2 px-3"
      style={{
        minHeight: 44,
        borderRadius: 12,
      }}
    >
      <SfIcon name="magnifyingglass" size={14} color={Colors.text2} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={t('peopleList.search')}
        placeholderTextColor={Colors.text2}
        accessibilityLabel={t('peopleList.search')}
        className="text-text1 flex-1 text-[14px]"
        style={{ padding: 0 }}
      />
    </ThemedSurface>
  );
}
