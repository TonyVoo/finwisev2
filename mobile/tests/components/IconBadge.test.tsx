import { render, screen } from '@testing-library/react-native';
import { IconBadge } from '@/components/IconBadge';

const hidden = { includeHiddenElements: true };

describe('IconBadge', () => {
  it('draws the named icon', async () => {
    await render(<IconBadge name="lock" />);
    expect(screen.getByTestId('row-icon-lock', hidden)).toBeTruthy();
  });

  it('is decorative: the row title beside it carries the meaning', async () => {
    await render(<IconBadge name="lock" />);
    expect(screen.getByTestId('icon-badge', hidden).props.accessibilityElementsHidden).toBe(true);
  });

  it('can be drawn as a warning for a destructive row', async () => {
    await render(<IconBadge name="trash-2" tone="danger" />);
    expect(screen.getByTestId('row-icon-trash-2', hidden)).toBeTruthy();
  });
});
