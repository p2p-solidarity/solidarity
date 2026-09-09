import { safeBack } from '@/navigation/safeBack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { View } from 'react-native';

import { SfIcon } from '@/components/icons/SfIcon';
import {
  SettingsBackToolbar,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';

/**
 * Stale deep links land on an honest unavailable state. Group credential
 * signing and delivery are intentionally not simulated with unsigned data.
 */
export default function GroupVCIssuanceUnavailable(): React.JSX.Element {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar onPress={() => { safeBack(); }} />
      <SettingsScreenTitle title={t('groupIssue.title')} />
      <View className="px-4 pt-6">
        <ThemedSurface variant="inset" padded className="gap-3">
          <SfIcon name="lock.fill" size={20} color={Colors.text3} />
          <ThemedText variant="bodyMedium">
            {t('groupIssue.unavailableButton')}
          </ThemedText>
          <ThemedText variant="bodySmall" tone="secondary">
            {t('groupIssue.unavailableReason')}
          </ThemedText>
          <ThemedButton
            variant="secondary"
            label={t('groupIssue.unavailableButton')}
            fullWidth
            disabled
          />
        </ThemedSurface>
      </View>
    </View>
  );
}
