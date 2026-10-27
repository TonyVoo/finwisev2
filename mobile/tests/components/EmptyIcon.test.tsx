import { render, screen } from '@testing-library/react-native';
import { EmptyIcon } from '@/components/EmptyIcon';

const hidden = { includeHiddenElements: true };

describe('EmptyIcon', () => {
  it('draws the named icon', async () => {
    await render(<EmptyIcon name="repeat" />);
    expect(screen.getByTestId('empty-icon-repeat', hidden)).toBeTruthy();
  });

  it('is decorative: the headline beside it carries the meaning', async () => {
    await render(<EmptyIcon name="target" />);
    expect(screen.getByTestId('empty-icon', hidden).props.accessibilityElementsHidden).toBe(true);
  });
});
