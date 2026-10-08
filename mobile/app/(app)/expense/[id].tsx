import { useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { ScreenPlaceholder } from '@/components/ScreenPlaceholder';

export default function EditExpenseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <ScreenPlaceholder title="Edit expense" spec="docs/design/06-expense-form.md">
      <Text>{id}</Text>
    </ScreenPlaceholder>
  );
}
