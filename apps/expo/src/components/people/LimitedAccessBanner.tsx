/**
 * LimitedAccessBanner — iOS 18+ limited Contacts access affordance.
 *
 * When the user grants access to only a hand-picked subset of contacts
 * (`accessPrivileges === 'limited'`), re-prompting does nothing and the import
 * list is frozen to whatever they shared first. This banner surfaces the two
 * escape hatches the OS gives us:
 *   - "Select more contacts" → `Contact.presentAccessPicker()` (system sheet
 *     that browses the FULL address book so the user can grant more).
 *   - "Allow full access ›"  → `Linking.openSettings()` to flip to full access.
 *
 * Rendered only by the import-from-phone screen; kept out of `app/` so Expo
 * Router doesn't treat it as a route.
 */
import { type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';

export function LimitedAccessBanner({
  count,
  working,
  onSelectMore,
  onOpenSettings,
}: {
  /** Number of contacts currently shared with the app. */
  readonly count: number;
  /** True while the access picker sheet is open / reloading. */
  readonly working: boolean;
  readonly onSelectMore: () => void;
  readonly onOpenSettings: () => void;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
      <View
        className="bg-searchBg rounded-sm2"
        style={{ padding: 12, borderWidth: 0.5, borderColor: Colors.divider }}
      >
        <View className="flex-row items-center" style={{ marginBottom: 10 }}>
          <SfIcon name="exclamationmark.triangle" size={14} color={Colors.text2} />
          <Text
            className="text-text1 text-[13px] font-medium flex-1"
            style={{ marginLeft: 8 }}
          >
            {t('contactImport.limitedBanner', { count })}
          </Text>
        </View>
        <ThemedButton
          label={t('contactImport.selectMore')}
          variant="secondary"
          fullWidth
          loading={working}
          onPress={onSelectMore}
        />
        <Pressable
          accessibilityRole="button"
          onPress={onOpenSettings}
          hitSlop={8}
          style={{ marginTop: 10, alignSelf: 'flex-start' }}
        >
          <Text className="text-text2 text-[13px]">
            {t('contactImport.allowFullAccess')} ›
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
