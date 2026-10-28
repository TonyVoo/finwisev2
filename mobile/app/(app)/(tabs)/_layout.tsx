import Feather from '@expo/vector-icons/Feather';
import { Tabs } from 'expo-router';
import { FloatingTabBar, type FloatingTabBarProps } from '@/navigation/tabBar';
import { useColors } from '@/theme/ThemeProvider';
import { COPY } from '@/copy/strings';

/**
 * The two tabs of the MVP: the expense list and the monthly summary.
 *
 * Settings is reached from the app bar on Home, not from a third tab
 * (`docs/design/04-expense-list.md` §Behaviour rule 14).
 *
 * The bar is our own (`FloatingTabBar`) rather than the navigator's built-in one, which has its
 * own idea of light and dark and knows nothing about ours, and cannot float.
 */
export default function TabsLayout() {
  const color = useColors();
  return (
    <Tabs
      // A capsule that floats over the screen instead of a bar stuck to the bottom edge.
      tabBar={(props) => <FloatingTabBar {...(props as unknown as FloatingTabBarProps)} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: color.bg.canvas },
      }}
    >
      {/* The bar draws whatever `tabBarIcon` returns; without one there is nothing. */}
      <Tabs.Screen
        name="index"
        options={{
          title: COPY.home.title,
          tabBarIcon: ({ color: tint, size }) => <Feather name="list" size={size} color={tint} />,
        }}
      />
      <Tabs.Screen
        name="summary"
        options={{
          title: COPY.summary.title,
          tabBarIcon: ({ color: tint, size }) => (
            <Feather name="pie-chart" size={size} color={tint} />
          ),
        }}
      />
    </Tabs>
  );
}
