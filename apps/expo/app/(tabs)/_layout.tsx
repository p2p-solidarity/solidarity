/**
 * Tab navigator — mirrors Swift MainTabView (3 tabs: people / share / me).
 * Per aniseekr-expo rule 10: tabs stay mounted across navigation (no
 * `unmountOnBlur`). Brand colours come from `Colors` (rule 4).
 */
import { Tabs } from 'expo-router';

import { Colors } from '@/constants/Colors';
import { ThemedText } from '@/components/themed';

const TAB_ICONS = {
  people: '👥',
  share: '📡',
  me: '🪪',
} as const;

function TabIcon({ name }: { readonly name: keyof typeof TAB_ICONS }) {
  return (
    <ThemedText variant="titleLarge" style={{ fontSize: 24 }}>
      {TAB_ICONS[name]}
    </ThemedText>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.accentRose,
      }}
    >
      <Tabs.Screen
        name="people/index"
        options={{ title: 'People', tabBarIcon: () => <TabIcon name="people" /> }}
      />
      <Tabs.Screen
        name="share/index"
        options={{ title: 'Share', tabBarIcon: () => <TabIcon name="share" /> }}
      />
      <Tabs.Screen
        name="me/index"
        options={{ title: 'Me', tabBarIcon: () => <TabIcon name="me" /> }}
      />
    </Tabs>
  );
}
