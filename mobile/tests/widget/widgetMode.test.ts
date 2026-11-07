import { META_KEYS, WIPED_META_KEYS } from '@/db/meta';
import { parseWidgetMode, portfolioWidgetText, WIDGET_LINKS } from '@/widget/widgetMode';

describe('the widget mode', () => {
  it('is spending unless the portfolio was chosen, whatever else is stored', () => {
    expect(parseWidgetMode('portfolio')).toBe('portfolio');
    expect(parseWidgetMode('spending')).toBe('spending');
    expect(parseWidgetMode(null)).toBe('spending');
    expect(parseWidgetMode('garbage')).toBe('spending');
  });

  it('is a device preference, not account data', () => {
    expect(WIPED_META_KEYS).not.toContain(META_KEYS.widgetMode);
  });

  it('opens a link the app already answers to', () => {
    expect(WIDGET_LINKS.spending).toBe('expensetracker://expense/new');
    expect(WIDGET_LINKS.portfolio).toBe('expensetracker://portfolio');
  });

  it('puts the change on the button, or Open when there is none', () => {
    expect(portfolioWidgetText('Portfolio', '5.500.000', '+10%', 'Open')).toEqual({
      title: 'Portfolio',
      amount: '5.500.000',
      button: '+10%',
      link: 'expensetracker://portfolio',
    });
    expect(portfolioWidgetText('Portfolio', '5.000.000', '', 'Open').button).toBe('Open');
  });
});
