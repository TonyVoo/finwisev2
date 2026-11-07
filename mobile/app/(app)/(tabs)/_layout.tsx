import Feather from '@expo/vector-icons/Feather';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Tabs } from 'expo-router';
import { FloatingTabBar, type FloatingTabBarProps } from '@/navigation/tabBar';
import { useColors, useTheme } from '@/theme/ThemeProvider';
import { COPY } from '@/copy/strings';

/**
 * The tabs: the expense list, the monthly summary, Investing and Settings. A receipt is read from Add expense
 * (`docs/design/11-receipt-scan.md`); the camera shortcut that used to sit in the bar is gone. Settings began as a button in
 * Home's app bar and became a tab once it held more than a few rows
 * (`docs/design/04-expense-list.md` §Behaviour rule 14).
 *
 * The bar is our own (`FloatingTabBar`) rather than the navigator's built-in one, which has its
 * own idea of light and dark and knows nothing about ours, and cannot float.
 */
export default function TabsLayout() {
  const color = useColors();
  // The cultivation appearance draws its own set: a spirit stone, a yin-yang, a compass, a temple.
  const tutien = useTheme().scheme === 'tutien';
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
          tabBarIcon: ({ color: tint, size }) =>
            tutien ? (
              <MaterialCommunityIcons name="diamond-stone" size={size} color={tint} />
            ) : (
              <Feather name="list" size={size} color={tint} />
            ),
        }}
      />
      <Tabs.Screen
        name="summary"
        options={{
          title: COPY.summary.title,
          tabBarIcon: ({ color: tint, size }) =>
            tutien ? (
              <MaterialCommunityIcons name="yin-yang" size={size} color={tint} />
            ) : (
              <Feather name="pie-chart" size={size} color={tint} />
            ),
        }}
      />
      <Tabs.Screen
        name="invest"
        options={{
          title: COPY.invest.title,
          tabBarIcon: ({ color: tint, size }) =>
            tutien ? (
              <MaterialCommunityIcons name="compass-rose" size={size} color={tint} />
            ) : (
              <Feather name="trending-up" size={size} color={tint} />
            ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: COPY.settings.title,
          tabBarIcon: ({ color: tint, size }) =>
            tutien ? (
              <MaterialCommunityIcons name="temple-buddhist" size={size} color={tint} />
            ) : (
              <Feather name="settings" size={size} color={tint} />
            ),
        }}
      />
    </Tabs>
  );
}
