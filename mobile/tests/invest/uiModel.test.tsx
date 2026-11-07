import { render, screen } from '@testing-library/react-native';
import type { MarketQuotePoint } from '@expense-tracker/shared';
import { goBack } from '@/navigation/goBack';
import { allocationOf, ALLOCATION_TEST_ID, AllocationBar } from '@/invest/AllocationBar';
import { ChangePill } from '@/invest/ChangePill';
import { columnAt, resampleRatios, sourceIndex, strokeOf } from '@/invest/chartModel';
import { groupDigits } from '@/invest/investModel';
import { positionInRange } from '@/invest/RangeBar';
import { filledSegments, scoreTone } from '@/invest/ScoreMeter';
import { hueFor } from '@/invest/SymbolAvatar';
import { tradeTotal } from '@/invest/TradeFormSheet';
import { emptyTradeDraft } from '@/invest/tradeModel';
import { PriceChart, PRICE_CHART_BAR_PREFIX, PRICE_CHART_RANGE_PREFIX } from '@/invest/PriceChart';
import { fireEvent } from '@testing-library/react-native';

const position = (symbol: string, cost: number) => ({
  symbol,
  quantity: 100,
  cost,
  avgCost: cost / 100,
  realized: 0,
  dividends: 0,
  oversold: 0,
});

describe('groupDigits', () => {
  it('groups thousands as it is typed and drops what is not a digit', () => {
    expect(groupDigits('1250000', 'en-US')).toBe('1,250,000');
    expect(groupDigits('₫1.250.000', 'vi-VN')).toBe('1.250.000');
    expect(groupDigits('12a5', 'en-US')).toBe('125');
  });

  it('has nothing for nothing, strips leading zeros and stops growing past a real amount', () => {
    expect(groupDigits('', 'en-US')).toBe('');
    expect(groupDigits('abc', 'en-US')).toBe('');
    expect(groupDigits('007', 'en-US')).toBe('7');
    expect(groupDigits('9'.repeat(20), 'en-US').replace(/\D/g, '')).toHaveLength(13);
  });
});

describe('chart geometry', () => {
  it('finds the column under a finger, clamped to the chart', () => {
    expect(columnAt(0, 300, 100)).toBe(0);
    expect(columnAt(150, 300, 100)).toBe(50);
    expect(columnAt(-20, 300, 100)).toBe(0);
    expect(columnAt(999, 300, 100)).toBe(99);
    expect(columnAt(10, 0, 100)).toBeNull();
    expect(columnAt(10, 300, 0)).toBeNull();
  });

  it('joins neighbouring columns into one unbroken line', () => {
    const ratios = [0.2, 0.5, 0.5, 0.1];
    // A climb: the edge spans from the lower neighbour up to this column.
    const climb = strokeOf(ratios, 1, 0.01);
    expect(climb.bottom).toBeCloseTo(0.2);
    expect(climb.height).toBeCloseTo(0.3);
    // Flat: a line of the minimum thickness at the top.
    const flat = strokeOf(ratios, 2, 0.01);
    expect(flat.bottom).toBeCloseTo(0.49);
    expect(flat.height).toBeCloseTo(0.01);
    // A drop: spans from this column up to the higher neighbour.
    const drop = strokeOf(ratios, 3, 0.01);
    expect(drop.bottom).toBeCloseTo(0.1);
    expect(drop.height).toBeCloseTo(0.4);
    // The first column has no neighbour to join.
    expect(strokeOf(ratios, 0, 0.01).height).toBe(0.01);
  });
});

describe('resampling', () => {
  it('joins the few levels the data has by straight lines across every column', () => {
    expect(resampleRatios([0, 1], 5)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(resampleRatios([0.2, 0.8, 0.2], 5)).toEqual([0.2, 0.5, 0.8, 0.5, 0.2]);
  });

  it('copes with one level, one column and none', () => {
    expect(resampleRatios([0.4], 3)).toEqual([0.4, 0.4, 0.4]);
    expect(resampleRatios([0.4, 0.9], 1)).toEqual([0.4]);
    expect(resampleRatios([], 5)).toEqual([]);
    expect(resampleRatios([0.4], 0)).toEqual([]);
  });

  it('points a column at the nearest day, first and last included', () => {
    expect(sourceIndex(0, 100, 30)).toBe(0);
    expect(sourceIndex(99, 100, 30)).toBe(29);
    expect(sourceIndex(50, 100, 30)).toBe(15);
    expect(sourceIndex(5, 100, 1)).toBe(0);
  });
});

describe('the 52-week bar and the score meter', () => {
  it('places a close in its range, in the middle when the range has no width', () => {
    expect(positionInRange(75, 50, 100)).toBe(0.5);
    expect(positionInRange(40, 50, 100)).toBe(0);
    expect(positionInRange(120, 50, 100)).toBe(1);
    expect(positionInRange(50, 50, 50)).toBe(0.5);
  });

  it('fills a fifth of the meter per twenty points', () => {
    expect([null, 0, 15, 20, 21, 60, 79, 100].map(filledSegments)).toEqual([
      0, 0, 1, 1, 2, 3, 4, 5,
    ]);
  });

  it('calls a score weak, middling or strong', () => {
    expect([null, 10, 39, 40, 59, 60, 100].map(scoreTone)).toEqual([
      'none',
      'weak',
      'weak',
      'middling',
      'middling',
      'strong',
      'strong',
    ]);
  });
});

describe('the portfolio picture', () => {
  it('splits by cost, widest first', () => {
    const slices = allocationOf([position('AAA', 1_000_000), position('BBB', 3_000_000)]);
    expect(slices.map((slice) => slice.symbol)).toEqual(['BBB', 'AAA']);
    expect(slices[0]?.share).toBeCloseTo(0.75);
  });

  it('draws nothing for nothing held', async () => {
    expect(allocationOf([])).toEqual([]);
    await render(<AllocationBar positions={[]} />);
    expect(screen.queryByTestId(ALLOCATION_TEST_ID)).toBeNull();
  });

  it('names the biggest holdings with their share', async () => {
    await render(
      <AllocationBar positions={[position('AAA', 1_000_000), position('BBB', 3_000_000)]} />,
    );
    expect(screen.getByText('BBB 75%')).toBeTruthy();
    expect(screen.getByText('AAA 25%')).toBeTruthy();
  });

  it('gives a symbol the same hue every time', () => {
    expect(hueFor('VNM')).toBe(hueFor('VNM'));
    expect(hueFor('')).toBeDefined();
  });
});

describe('the change pill', () => {
  it('says the move with its sign in words for a screen reader', async () => {
    await render(<ChangePill fraction={0.0123} testID="pill" />);
    expect(screen.getByTestId('pill').props.accessibilityLabel).toBe('+1.2%');
    expect(screen.getByText('1.2%')).toBeTruthy();
  });

  it('is neutral for no movement and absent for no figure', async () => {
    await render(<ChangePill fraction={0} testID="flat" />);
    expect(screen.getByTestId('flat').props.accessibilityLabel).toBe('0%');
    await render(<ChangePill fraction={null} testID="none" />);
    expect(screen.queryByTestId('none')).toBeNull();
  });
});

describe('the trade total', () => {
  const draft = {
    ...emptyTradeDraft('2026-11-06'),
    quantityText: '100',
    priceText: '50,000',
    feeText: '7,500',
  };

  it('adds the fee to a buy and takes it from a sell', () => {
    expect(tradeTotal({ ...draft, side: 'buy' })).toBe(5_007_500);
    expect(tradeTotal({ ...draft, side: 'sell' })).toBe(4_992_500);
  });

  it('is unknown until shares and price are both there', () => {
    expect(tradeTotal({ ...draft, quantityText: '' })).toBeNull();
    expect(tradeTotal({ ...draft, priceText: '' })).toBeNull();
  });
});

describe('going back', () => {
  it('goes back when there is somewhere to go', () => {
    const router = { canGoBack: () => true, back: jest.fn(), replace: jest.fn() };
    goBack(router, '/home');
    expect(router.back).toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('goes to the fallback when opened with no history, instead of an unhandled GO_BACK', () => {
    const router = { canGoBack: () => false, back: jest.fn(), replace: jest.fn() };
    goBack(router, '/home');
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/home');
  });
});

describe('the price chart', () => {
  const series: MarketQuotePoint[] = Array.from({ length: 300 }, (_, i) => ({
    date: `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
    close: 50_000 + i * 10,
    volume: 1,
  }));

  it('draws a labelled column per day and changes range when a pill is pressed', async () => {
    await render(<PriceChart series={series} format={(value) => `${value} d`} />);
    const columns = () => screen.getAllByTestId(new RegExp(`^${PRICE_CHART_BAR_PREFIX}-`));
    const before = columns().length;
    expect(before).toBeGreaterThan(10);
    expect(columns()[0]?.props.accessibilityLabel).toMatch(/^\d{4}-\d{2}-\d{2}, \d+ d$/);

    await fireEvent.press(screen.getByTestId(`${PRICE_CHART_RANGE_PREFIX}-1m`));

    expect(columns().length).toBeLessThanOrEqual(before);
    expect(
      screen.getByTestId(`${PRICE_CHART_RANGE_PREFIX}-1m`).props.accessibilityState.selected,
    ).toBe(true);
  });
});
