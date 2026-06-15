/**
 * Tabs layout — 1:1 port of Swift MainTabView + CustomFloatingTabBar.
 *
 * Renders the three primary tabs (People / Share / Me) and delegates
 * the bottom bar to `FloatingTabBar`, which mirrors Swift
 * `CustomFloatingTabBar` (flat divider + pageBg + tap haptic).
 */
import { Tabs } from 'expo-router';

import { FloatingTabBar, type FloatingTabBarProps } from '@/components/tabs/FloatingTabBar';
import { useTranslation } from '@/i18n';

export default function TabsLayout() {
  const { t } = useTranslation();
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <FloatingTabBar {...(props as unknown as FloatingTabBarProps)} />}
    >
      <Tabs.Screen name="people/index" options={{ title: t('tab.people') }} />
      <Tabs.Screen name="share/index" options={{ title: t('tab.share') }} />
      <Tabs.Screen name="me/index" options={{ title: t('tab.me') }} />
    </Tabs>
  );
}
