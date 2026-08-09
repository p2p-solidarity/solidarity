import { View } from 'react-native';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useThemeColors } from '@/constants/useThemeColors';
import { useTranslation } from '@/i18n';

/**
 * v2 Page section summary. Links are the one section that exists in the
 * current signed page record and always stays first, so it is intentionally
 * read-only here. Other section types are not shown until they have a real
 * persisted/published data path.
 */
export function ProfileSectionsList({ linkCount }: { readonly linkCount: number }) {
  const { t } = useTranslation();
  const c = useThemeColors();

  return (
    <View className="gap-3 px-4">
      <ThemedText accessibilityRole="header" variant="label" tone="tertiary">
        {t('mePage.sections')}
      </ThemedText>
      <ThemedSurface
        variant="card"
        className="flex-row items-center gap-3 rounded-none px-4 py-3">
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: c.searchBg,
          }}>
          <SfIcon name="link" size={16} color={Colors.primaryBlue} />
        </View>
        <View className="flex-1 gap-0.5">
          <ThemedText variant="bodyMedium">{t('mePage.links')}</ThemedText>
          <ThemedText variant="caption" tone="tertiary">
            {t('mePage.linkCount', { count: linkCount })}
          </ThemedText>
        </View>
      </ThemedSurface>
    </View>
  );
}
