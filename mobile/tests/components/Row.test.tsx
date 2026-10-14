import { Text } from 'react-native';
import { fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import {
  ROW_CHEVRON_TEST_ID,
  ROW_SEPARATOR_TEST_ID,
  Row,
  RowSubtitle,
  RowTitle,
  Swatch,
} from '@/components/Row';
import { color, radius, size } from '@/theme/tokens';
import { flattenStyle } from '../support/safeArea';

/**
 * The row: `docs/design/00-foundations.md` §6, plus §2 note 1 on heights.
 *
 * Two things here are worth a test rather than an eye. The first is that 56 is a *floor*:
 * a row with `height: 56` looks identical to one with `minHeight: 56` until someone turns
 * the font scale up, and then it clips. The second is that this component takes
 * accessibility props and gets out of the way — the composed label belongs to the screen
 * (`04-expense-list.md` §Accessibility), and a row that invented its own would fight it.
 */

/** The chevron and the separator are decorative, so queries must opt into hidden ones. */
function queryDecorative(testID: string) {
  return screen.queryByTestId(testID, { includeHiddenElements: true });
}

describe('Row', () => {
  it('renders its children', async () => {
    await render(
      <Row>
        <Text>Coffee</Text>
      </Row>,
    );

    expect(screen.getByText('Coffee')).toBeTruthy();
  });

  it('renders the leading and trailing slots', async () => {
    await render(
      <Row leading={<Text>icon</Text>} trailing={<Text>-4.50</Text>}>
        <Text>Coffee</Text>
      </Row>,
    );

    expect(screen.getByText('icon')).toBeTruthy();
    expect(screen.getByText('-4.50')).toBeTruthy();
  });

  it('treats 56 as a floor, so it grows with the font scale', async () => {
    // §2 note 1. A fixed height is the most common way a Dynamic Type setting turns a
    // legible screen into a clipped one, so the absence of `height` is the assertion.
    await render(
      <Row testID="row">
        <Text>Coffee</Text>
      </Row>,
    );
    const style = flattenStyle(screen.getByTestId('row').props.style);

    expect(style.minHeight).toBe(size.rowMinHeight);
    expect(style.height).toBeUndefined();
  });

  describe('as a touchable', () => {
    it('calls onPress and reads as a button', async () => {
      const onPress = jest.fn();
      await render(
        <Row onPress={onPress} testID="row">
          <Text>Coffee</Text>
        </Row>,
      );

      await userEvent.press(screen.getByTestId('row'));

      expect(onPress).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('row').props.accessibilityRole).toBe('button');
    });

    it('is inert and roleless with no onPress', async () => {
      // A category row in a read-only group is still a row. Reporting it as a button
      // would promise a screen reader user something that does not happen.
      await render(
        <Row testID="row">
          <Text>Coffee</Text>
        </Row>,
      );
      const row = screen.getByTestId('row');

      expect(row.props.accessibilityRole).toBeUndefined();
      expect(row.props.accessibilityState).toMatchObject({ disabled: true });
    });
  });

  describe('the chevron', () => {
    it('is absent unless the row opens something', async () => {
      await render(
        <Row testID="row">
          <Text>Groceries</Text>
        </Row>,
      );

      expect(queryDecorative(ROW_CHEVRON_TEST_ID)).toBeNull();
    });

    it('is drawn when the row opens something', async () => {
      await render(
        <Row chevron onPress={jest.fn()} testID="row">
          <Text>Groceries</Text>
        </Row>,
      );

      expect(queryDecorative(ROW_CHEVRON_TEST_ID)).toBeTruthy();
    });
  });

  describe('the separator', () => {
    it('is inset to the content edge rather than full-bleed', async () => {
      // §6. Full-bleed separators make a list read as a stack of cards; the inset is
      // what makes it read as one group.
      await render(
        <Row testID="row">
          <Text>Coffee</Text>
        </Row>,
      );
      const style = flattenStyle(queryDecorative(ROW_SEPARATOR_TEST_ID)?.props.style);

      expect(style.left as number).toBeGreaterThan(0);
      expect(style.right).toBe(0);
      expect(style.backgroundColor).toBe(color.border.hairline);
    });

    it('is dropped on the last row of a group', async () => {
      await render(
        <Row lastInGroup testID="row">
          <Text>Coffee</Text>
        </Row>,
      );

      expect(queryDecorative(ROW_SEPARATOR_TEST_ID)).toBeNull();
    });
  });

  describe('accessibility', () => {
    it('becomes one element once it is given a composed label', async () => {
      // §8 rule 6: a screen reader should announce `Coffee, 4.50, today` and not walk
      // three separate texts.
      await render(
        <Row
          accessibilityLabel="Coffee, 4.50 dollars, today"
          accessibilityHint="Opens the expense"
          onPress={jest.fn()}
          testID="row"
        >
          <Text>Coffee</Text>
          <Text>-4.50</Text>
        </Row>,
      );
      const row = screen.getByTestId('row');

      expect(row.props.accessible).toBe(true);
      expect(row.props.accessibilityLabel).toBe('Coffee, 4.50 dollars, today');
      expect(row.props.accessibilityHint).toBe('Opens the expense');
    });

    it('does not claim to be one element when it has no label of its own', async () => {
      // The composition is per-screen. A row that collapsed its children without a
      // label would announce nothing at all.
      await render(
        <Row testID="row">
          <Text>Coffee</Text>
        </Row>,
      );

      expect(screen.getByTestId('row').props.accessible).toBe(false);
    });

    it('passes a custom action through to its handler', async () => {
      // The swipe gesture is invisible to a screen reader, so delete is also an
      // accessibility action (`04-expense-list.md` §Accessibility rule 3). The row
      // forwards it; the screen decides what it means.
      const onAccessibilityAction = jest.fn();
      await render(
        <Row
          accessibilityLabel="Coffee, 4.50 dollars, today"
          accessibilityActions={[{ name: 'delete', label: 'Delete' }]}
          onAccessibilityAction={onAccessibilityAction}
          onPress={jest.fn()}
          testID="row"
        >
          <Text>Coffee</Text>
        </Row>,
      );

      expect(screen.getByTestId('row').props.accessibilityActions).toEqual([
        { name: 'delete', label: 'Delete' },
      ]);

      fireEvent(screen.getByTestId('row'), 'accessibilityAction', {
        nativeEvent: { actionName: 'delete' },
      });

      expect(onAccessibilityAction).toHaveBeenCalledWith(
        expect.objectContaining({ nativeEvent: { actionName: 'delete' } }),
      );
    });
  });
});

describe('RowTitle and RowSubtitle', () => {
  it('keep each line to one line, so a long note cannot reflow the list', async () => {
    await render(
      <Row>
        <RowTitle>Coffee at the place on the corner</RowTitle>
        <RowSubtitle>Eating out</RowSubtitle>
      </Row>,
    );

    expect(screen.getByText('Coffee at the place on the corner').props.numberOfLines).toBe(1);
    expect(screen.getByText('Eating out').props.numberOfLines).toBe(1);
  });

  it('separates the two lines by colour, not by size alone', async () => {
    await render(
      <Row>
        <RowTitle>Coffee</RowTitle>
        <RowSubtitle>Eating out</RowSubtitle>
      </Row>,
    );

    expect(flattenStyle(screen.getByText('Coffee').props.style).color).toBe(color.text.primary);
    expect(flattenStyle(screen.getByText('Eating out').props.style).color).toBe(
      color.text.secondary,
    );
  });
});

describe('Swatch', () => {
  it('is a 24pt rounded square of the category colour', async () => {
    await render(<Swatch colorHex="#2563EB" />);
    const style = flattenStyle(
      screen.getByTestId('swatch', { includeHiddenElements: true }).props.style,
    );

    expect(style.width).toBe(size.swatch);
    expect(style.height).toBe(size.swatch);
    expect(style.borderRadius).toBe(radius.sm);
    expect(style.backgroundColor).toBe('#2563EB');
  });

  it('takes a larger diameter where a screen asks for one', async () => {
    await render(<Swatch colorHex="#2563EB" diameter={32} />);
    const style = flattenStyle(
      screen.getByTestId('swatch', { includeHiddenElements: true }).props.style,
    );

    expect(style.width).toBe(32);
    expect(style.height).toBe(32);
  });

  it('is decorative, because the ten hues are not distinguishable by lightness', async () => {
    // `00-foundations.md` §1.3. The category's name is beside it and carries the
    // identity; announcing "blue square" would add nothing and mislead under a colour
    // vision deficiency.
    await render(<Swatch colorHex="#2563EB" />);

    expect(screen.queryByTestId('swatch')).toBeNull();
    const swatch = screen.getByTestId('swatch', { includeHiddenElements: true });
    expect(swatch.props.accessibilityElementsHidden).toBe(true);
  });
});
