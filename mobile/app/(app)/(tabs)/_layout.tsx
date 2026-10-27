import Feather from '@expo/vector-icons/Feather';
import { Tabs } from 'expo-router';
import { useColors } from '@/theme/ThemeProvider';
import { COPY } from '@/copy/strings';

/**
 * The two tabs of the MVP: the expense list and the monthly summary.
 *
 * Settings is reached from the app bar on Home, not from a third tab
 * (`docs/design/04-expense-list.md` §Behaviour rule 14).
 *
 * The bar is coloured here rather than left to the navigator's built-in theme, which has
 * its own idea of light and dark and knows nothing about ours: left alone it stays white
 * under a dark app.
 */
export default function TabsLayout() {
  const color = useColors();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: color.bg.canvas },
        tabBarStyle: {
          backgroundColor: color.bg.surface,
          borderTopColor: color.border.hairline,
        },
        tabBarActiveTintColor: color.primary.default,
        tabBarInactiveTintColor: color.text.tertiary,
      }}
    >
      {/* Without a `tabBarIcon` the navigator draws nothing at all - a bare label. */}
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
