import { Switch, type SwitchProps } from 'react-native';
import { useColors, useTheme } from '../theme/ThemeProvider';

/**
 * The system switch, which in the cultivation appearance takes a gold track and a parchment thumb instead of the
 * platform's green. Everywhere else it is the plain `Switch`, untouched.
 */
export function Toggle(props: SwitchProps) {
  const color = useColors();
  const tutien = useTheme().scheme === 'tutien';
  if (!tutien) return <Switch {...props} />;
  return (
    <Switch
      trackColor={{ false: color.border.strong, true: color.primary.default }}
      thumbColor={color.text.primary}
      ios_backgroundColor={color.border.strong}
      {...props}
    />
  );
}
