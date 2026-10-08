import { Tabs } from 'expo-router';

/**
 * The two tabs of the MVP: the expense list and the monthly summary.
 *
 * Settings is reached from the app bar on Home, not from a third tab
 * (`docs/design/04-expense-list.md` §Behaviour rule 14).
 */
export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ title: 'Expenses' }} />
      <Tabs.Screen name="summary" options={{ title: 'Summary' }} />
    </Tabs>
  );
}
