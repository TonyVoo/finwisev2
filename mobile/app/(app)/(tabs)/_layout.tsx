import { Tabs } from 'expo-router';
import { TabIcon, tabPressHaptic } from '@/navigation/tabBar';
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
      // Fires for the tab being pressed, so `isFocused` is whether it is the current one.
      screenListeners={({ navigation }) => ({
        tabPress: () => tabPressHaptic(navigation.isFocused()),
      })}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: color.bg.canvas },
        tabBarStyle: {
          backgroundColor: color.bg.surface,
          borderTopColor: color.border.hairline,
        },
        tabBarActiveTintColor: color.primary.default,
        tabBarInactiveTintColor: color.text.tertiary,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      {/* Without a `tabBarIcon` the navigator draws nothing at all - a bare label. */}
      <Tabs.Screen
        name="index"
        options={{
          title: COPY.home.title,
          tabBarIcon: ({ color: tint, focused }) => (
            <TabIcon name="list" focused={focused} tint={tint} />
          ),
        }}
      />
      <Tabs.Screen
        name="summary"
        options={{
          title: COPY.summary.title,
          tabBarIcon: ({ color: tint, focused }) => (
            <TabIcon name="pie-chart" focused={focused} tint={tint} />
          ),
        }}
      />
    </Tabs>
  );
}
