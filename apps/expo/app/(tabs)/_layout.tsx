/**
 * Tabs layout — originally a 1:1 port of Swift MainTabView +
 * CustomFloatingTabBar; converted for 1.3.3 (Task A0.2) to the Verified
 * Page IA: People / Me / Verify (Share tab removed, see
 * docs/ref/03-app-web-mechanisms.md §5/§6).
 *
 * Renders the three primary tabs and delegates the bottom bar to
 * `FloatingTabBar`, which mirrors Swift `CustomFloatingTabBar` (flat
 * divider + pageBg + tap haptic).
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
      <Tabs.Screen name="me/index" options={{ title: t('tab.me') }} />
      <Tabs.Screen name="verify/index" options={{ title: t('tab.verify') }} />
    </Tabs>
  );
}
