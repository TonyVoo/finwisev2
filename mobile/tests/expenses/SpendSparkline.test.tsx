import { render, screen } from '@testing-library/react-native';
import { MonthTotal } from '@/expenses/MonthTotal';
import {
  SPARKLINE_BAR_TEST_ID_PREFIX,
  SPARKLINE_TEST_ID,
  SpendSparkline,
} from '@/expenses/SpendSparkline';
import { flattenStyle } from '../support/safeArea';

const hidden = { includeHiddenElements: true };

describe('SpendSparkline', () => {
  it('draws one slot per day of the month', async () => {
    await render(<SpendSparkline series={[10, 10, 40]} daysInMonth={5} />);

    for (let day = 1; day <= 5; day += 1) {
      expect(screen.getByTestId(`${SPARKLINE_BAR_TEST_ID_PREFIX}-${day}`, hidden)).toBeTruthy();
    }
    expect(screen.queryByTestId(`${SPARKLINE_BAR_TEST_ID_PREFIX}-6`, hidden)).toBeNull();
  });

  it('scales bars to the largest running total, and leaves future days at the floor', async () => {
    await render(<SpendSparkline series={[10, 40]} daysInMonth={3} />);

    const height = (day: number) =>
      flattenStyle(screen.getByTestId(`${SPARKLINE_BAR_TEST_ID_PREFIX}-${day}`, hidden).props.style)
        .height as number;
    expect(height(2)).toBeGreaterThan(height(1));
    expect(height(3)).toBeLessThan(height(1));
  });

  it('is decorative: the figure beside it carries the meaning', async () => {
    await render(<SpendSparkline series={[10, 40]} daysInMonth={3} />);

    const root = screen.getByTestId(SPARKLINE_TEST_ID, hidden);
    expect(root.props.accessibilityElementsHidden).toBe(true);
  });

  it('renders nothing when nothing has been spent', async () => {
    await render(<SpendSparkline series={[0, 0, 0]} daysInMonth={3} />);

    expect(screen.queryByTestId(SPARKLINE_TEST_ID, hidden)).toBeNull();
  });
});

describe('MonthTotal with a spend series', () => {
  it('shows the sparkline under the figure', async () => {
    await render(
      <MonthTotal
        totalMinor={4000}
        currency="USD"
        isCurrentMonth
        series={[1000, 4000]}
        daysInMonth={30}
      />,
    );

    expect(screen.getByTestId(SPARKLINE_TEST_ID, hidden)).toBeTruthy();
  });

  it('shows none without a series', async () => {
    await render(<MonthTotal totalMinor={4000} currency="USD" isCurrentMonth />);

    expect(screen.queryByTestId(SPARKLINE_TEST_ID, hidden)).toBeNull();
  });
});
