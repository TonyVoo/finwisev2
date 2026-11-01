import Feather from '@expo/vector-icons/Feather';
import { Tabs } from 'expo-router';
import { FloatingTabBar, type FloatingTabBarProps } from '@/navigation/tabBar';
import { useColors } from '@/theme/ThemeProvider';
import { COPY } from '@/copy/strings';
import { useScanShortcut } from '@/receipts/useScanShortcut';

/**
 * The tabs: the expense list and the monthly summary, then savings goals and Settings, with a camera
 * button in the middle that opens Add expense with a receipt photo (`docs/design/11-receipt-scan.md`). Settings began as a button in
 * Home's app bar and became a tab once it held more than a few rows
 * (`docs/design/04-expense-list.md` §Behaviour rule 14).
 *
 * The bar is our own (`FloatingTabBar`) rather than the navigator's built-in one, which has its
 * own idea of light and dark and knows nothing about ours, and cannot float.
 */
export default function TabsLayout() {
  const color = useColors();
  const scan = useScanShortcut();
  return (
    <Tabs
      // A capsule that floats over the screen instead of a bar stuck to the bottom edge.
      tabBar={(props) => (
        <FloatingTabBar
          {...(props as unknown as FloatingTabBarProps)}
          onScan={() => void scan.start()}
        />
      )}
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
      {/* Not a screen: the bar draws it as the camera button and runs `onScan` (`tabBar.tsx`). */}
      <Tabs.Screen
        name="scan"
        options={{
          title: COPY.scan.tab,
          tabBarIcon: ({ color: tint, size }) => <Feather name="camera" size={size} color={tint} />,
        }}
      />
      <Tabs.Screen
        name="goals"
        options={{
          title: COPY.goals.tab,
          tabBarIcon: ({ color: tint, size }) => <Feather name="target" size={size} color={tint} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: COPY.settings.title,
          tabBarIcon: ({ color: tint, size }) => (
            <Feather name="settings" size={size} color={tint} />
          ),
        }}
      />
    </Tabs>
  );
}
