import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { ScreenPlaceholder } from '@/components/ScreenPlaceholder';

/**
 * Also the smoke test for the testing setup itself: jest-expo transforming TSX,
 * `@testing-library/react-native` rendering a real React Native tree, and queries
 * resolving against it. If this suite fails, no component test in the project can be
 * trusted.
 */
describe('ScreenPlaceholder', () => {
  it('renders the title as a heading', async () => {
    await render(<ScreenPlaceholder title="Expenses" spec="docs/design/04-expense-list.md" />);

    expect(screen.getByRole('header', { name: 'Expenses' })).toBeTruthy();
  });

  it('names the spec it stands in for', async () => {
    await render(<ScreenPlaceholder title="Summary" spec="docs/design/08-monthly-summary.md" />);

    // The route tree doubles as the remaining-work list, so each stub says which spec
    // will replace it.
    expect(screen.getByText('docs/design/08-monthly-summary.md')).toBeTruthy();
  });

  it('renders children below the title', async () => {
    await render(
      <ScreenPlaceholder title="Expenses" spec="docs/design/04-expense-list.md">
        <Text>Local categories: 6</Text>
      </ScreenPlaceholder>,
    );

    expect(screen.getByText('Local categories: 6')).toBeTruthy();
  });
});
