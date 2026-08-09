import * as WebBrowser from 'expo-web-browser';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import {
  SettingsBackToolbar,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { safeBack } from '@/navigation/safeBack';

const PRO_MANAGEMENT_URL = 'https://creds.id/upgrade';

const FREE_FEATURE_KEYS = [
  'pro.free.verification',
  'pro.free.monitoring',
  'pro.free.exchange',
  'pro.free.theme',
  'pro.free.domainIdentity',
] as const;

const PRO_FEATURE_KEYS = [
  'pro.feature.domain',
  'pro.feature.maintenance',
  'pro.feature.leaveCard',
  'pro.feature.control',
  'pro.feature.dashboard',
] as const;

export default function ProSettingsScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const [openingBrowser, setOpeningBrowser] = useState(false);

  const openManagement = async (): Promise<void> => {
    if (openingBrowser) return;
    setOpeningBrowser(true);
    try {
      await WebBrowser.openBrowserAsync(PRO_MANAGEMENT_URL);
    } catch {
      haptic('error');
      pushToast(t('pro.browserError'), 'error');
    } finally {
      setOpeningBrowser(false);
    }
  };

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar onPress={() => { safeBack('/settings'); }} />
      <SettingsScreenTitle title={t('pro.title')} />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: insets.bottom + 40 }}>
        <View className="gap-4">
          <LinearGradient
            colors={[Colors.heroGradientStart, Colors.heroGradientEnd]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ borderRadius: 20, overflow: 'hidden', padding: 18 }}>
            <View className="flex-row items-center justify-between gap-3">
              <View className="gap-1">
                <ThemedText variant="titleLarge">Pro</ThemedText>
                <ThemedText variant="bodyMedium" tone="secondary">
                  {t('pro.price')}
                </ThemedText>
              </View>
              <View
                className="items-center justify-center rounded-full"
                style={{ width: 44, height: 44, backgroundColor: Colors.cardSurface }}>
                <SfIcon name="sparkles" size={19} color={Colors.primaryMauve} />
              </View>
            </View>
            <ThemedText variant="bodySmall" tone="secondary" className="pt-4">
              {t('pro.promise')}
            </ThemedText>
          </LinearGradient>

          <PlanCard title={t('pro.free')} price="$0" featureKeys={FREE_FEATURE_KEYS} />
          <PlanCard
            title="Pro"
            price={t('pro.price')}
            featureKeys={PRO_FEATURE_KEYS}
            featured
          />

          <ThemedButton
            label={t('pro.manageInBrowser')}
            variant="primary"
            fullWidth
            loading={openingBrowser}
            onPress={() => { void openManagement(); }}
          />
          <ThemedText variant="caption" tone="tertiary" style={{ textAlign: 'center' }}>
            {t('pro.browserHint')}
          </ThemedText>

          <PressableScale
            haptic="tap"
            onPress={() => { void openManagement(); }}
            accessibilityRole="link"
            accessibilityLabel={t('pro.manageInBrowser')}>
            <ThemedSurface
              variant="inset"
              className="flex-row items-center gap-3 rounded-xl px-4 py-3">
              <SfIcon name="person.3" size={16} color={Colors.primaryMauve} />
              <View className="flex-1 gap-0.5">
                <ThemedText variant="bodyMedium">{t('pro.organization')}</ThemedText>
                <ThemedText variant="caption" tone="tertiary">
                  {t('pro.organizationHint')}
                </ThemedText>
              </View>
              <SfIcon name="arrow.up.right" size={12} color={Colors.text3} />
            </ThemedSurface>
          </PressableScale>
        </View>
      </ScrollView>
    </View>
  );
}

function PlanCard({
  title,
  price,
  featureKeys,
  featured = false,
}: {
  readonly title: string;
  readonly price: string;
  readonly featureKeys: readonly string[];
  readonly featured?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <ThemedSurface
      variant={featured ? 'outlined' : 'card'}
      className="gap-3 rounded-2xl p-4"
      style={featured ? { borderColor: Colors.primaryMauve, borderWidth: 1.5 } : undefined}>
      <View className="flex-row items-baseline justify-between gap-3">
        <ThemedText variant="titleMedium">{title}</ThemedText>
        <ThemedText variant="label" tone={featured ? 'accent' : 'secondary'}>
          {price}
        </ThemedText>
      </View>
      <View className="gap-2.5">
        {featureKeys.map((key) => (
          <View key={key} className="flex-row items-start gap-2.5">
            <SfIcon name="checkmark" size={12} color={Colors.terminalGreen} />
            <ThemedText variant="bodySmall" tone="secondary" style={{ flex: 1 }}>
              {t(key)}
            </ThemedText>
          </View>
        ))}
      </View>
    </ThemedSurface>
  );
}
