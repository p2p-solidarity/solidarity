/**
 * Tabs layout — 1:1 port of Swift MainTabView + CustomFloatingTabBar.
 *
 * 3 tabs (People / Share / Me) with Swift SF Symbol icons:
 *   people  → person.2
 *   share   → dot.radiowaves.left.and.right
 *   me      → person.crop.circle
 *
 * Active tint = textPrimary, inactive = textTertiary (Swift Color.Theme).
 * Bar has a 0.5pt top divider + pageBg background (Swift CustomFloatingTabBar).
 */
import { Tabs } from 'expo-router';

import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';

const TAB_ICONS = {
  people: 'person.2',
  share: 'dot.radiowaves.left.and.right',
  me: 'person.crop.circle',
} as const;

function TabIcon({
  name,
  focused,
}: {
  readonly name: keyof typeof TAB_ICONS;
  readonly focused: boolean;
}) {
  return (
    <SfIcon
      name={TAB_ICONS[name]}
      size={20}
      color={focused ? Colors.text1 : Colors.text3}
    />
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.text1,
        tabBarInactiveTintColor: Colors.text3,
        tabBarStyle: {
          backgroundColor: Colors.pageBg,
          borderTopColor: Colors.divider,
          borderTopWidth: 0.5,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
        },
      }}
    >
      <Tabs.Screen
        name="people/index"
        options={{
          title: 'People',
          tabBarIcon: ({ focused }) => <TabIcon name="people" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="share/index"
        options={{
          title: 'Share',
          tabBarIcon: ({ focused }) => <TabIcon name="share" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="me/index"
        options={{
          title: 'Me',
          tabBarIcon: ({ focused }) => <TabIcon name="me" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
