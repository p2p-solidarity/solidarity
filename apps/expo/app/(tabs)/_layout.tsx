/**
 * Tab navigator — mirrors Swift MainTabView (3 tabs: people / share / me).
 *
 * Per Swift: tabs stay mounted across navigation. Don't pass `unmountOnBlur`
 * (aniseekr-expo rule 10) — re-mount on tab switch breaks scroll restoration
 * + cold-paths every tab on every focus.
 */
import { Tabs } from 'expo-router';
import { Text } from 'react-native';

const TAB_ICONS = {
  people: '👥',
  share: '📡',
  me: '🪪',
} as const;

function TabIcon({ name }: { readonly name: keyof typeof TAB_ICONS }) {
  return <Text style={{ fontSize: 24 }}>{TAB_ICONS[name]}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#D8466B',
      }}
    >
      <Tabs.Screen
        name="people/index"
        options={{
          title: 'People',
          tabBarIcon: () => <TabIcon name="people" />,
        }}
      />
      <Tabs.Screen
        name="share/index"
        options={{
          title: 'Share',
          tabBarIcon: () => <TabIcon name="share" />,
        }}
      />
      <Tabs.Screen
        name="me/index"
        options={{
          title: 'Me',
          tabBarIcon: () => <TabIcon name="me" />,
        }}
      />
    </Tabs>
  );
}
