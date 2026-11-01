import { render, screen } from '@testing-library/react-native';
import { INSIGHTS_TEST_ID, InsightsCard } from '@/summary/InsightsCard';

/** The Summary Insights card (`docs/design/16-monthly-insights.md`): one short list of plain sentences. */

describe('InsightsCard', () => {
  it('says nothing, and takes no room, when there is nothing to say', async () => {
    await render(<InsightsCard insights={[]} previousLabel="September" currency="USD" />);
    expect(screen.queryByTestId(INSIGHTS_TEST_ID)).toBeNull();
  });

  it('lists each insight as a sentence, the budget line among them', async () => {
    await render(
      <InsightsCard
        insights={[
          { kind: 'topCategory', name: 'Groceries', percent: 24 },
          { kind: 'budgetPace', name: 'Eating out', usedPercent: 87, daysLeft: 9 },
        ]}
        previousLabel="September"
        currency="USD"
      />,
    );

    expect(
      screen.getByText('Groceries is your biggest category, at 24% of the month.'),
    ).toBeTruthy();
    expect(
      screen.getByText("You have used 87% of Eating out's budget with 9 days left."),
    ).toBeTruthy();
  });

  it('can show a budget that is over, beside a budget that is merely close', async () => {
    await render(
      <InsightsCard
        insights={[{ kind: 'budgetOver', name: 'Food', overMinor: 1200 }]}
        previousLabel="September"
        currency="USD"
      />,
    );

    expect(screen.getByText(/You are over Food's budget by/)).toBeTruthy();
  });
});
