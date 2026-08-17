/**
 * Tabs layout — originally a 1:1 port of Swift MainTabView +
 * CustomFloatingTabBar; converted for 1.3.3 (Task A0.2) to the Verified
 * Page IA. v2 keeps the existing route folders for compatibility while the
 * product-facing order becomes Page / Present / Contacts.
 *
 * Renders the three primary tabs and delegates the bottom bar to
 * `FloatingTabBar`, which mirrors Swift `CustomFloatingTabBar` (flat
 * divider + pageBg + tap haptic).
 */
import { Tabs } from 'expo-router';

import { FloatingTabBar, type FloatingTabBarProps } from '@/components/tabs/FloatingTabBar';
import { useTranslation } from '@/i18n';
import { PRIMARY_TABS } from '@/navigation/primaryTabs';

export default function TabsLayout() {
  const { t } = useTranslation();
  const [pageTab, presentTab, contactsTab] = PRIMARY_TABS;
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <FloatingTabBar {...(props as unknown as FloatingTabBarProps)} />}
    >
      <Tabs.Screen name={pageTab.route} options={{ title: t(pageTab.titleKey) }} />
      <Tabs.Screen name={presentTab.route} options={{ title: t(presentTab.titleKey) }} />
      <Tabs.Screen name={contactsTab.route} options={{ title: t(contactsTab.titleKey) }} />
    </Tabs>
  );
}
