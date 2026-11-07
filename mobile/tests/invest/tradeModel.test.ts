import { COPY } from '@/copy/strings';
import { draftFromTrade, emptyTradeDraft, validateTradeDraft } from '@/invest/tradeModel';

const good = {
  ...emptyTradeDraft('2026-11-06'),
  symbolText: 'vnm',
  quantityText: '100',
  priceText: '56.800',
  feeText: '8.520',
};

describe('validateTradeDraft', () => {
  it('reads a complete draft as whole numbers and an upper-case ticker', () => {
    expect(validateTradeDraft(good)).toEqual({
      ok: true,
      value: {
        symbol: 'VNM',
        side: 'buy',
        quantity: 100,
        price: 56800,
        fee: 8520,
        date: '2026-11-06',
      },
    });
  });

  it('takes an empty or zero fee as no fee', () => {
    for (const feeText of ['', '  ', '0', '000']) {
      const result = validateTradeDraft({ ...good, feeText });
      expect(result.ok && result.value.fee).toBe(0);
    }
  });

  it('keeps a trimmed note and drops an empty one', () => {
    const withNote = validateTradeDraft({ ...good, noteText: '  first lot ' });
    expect(withNote.ok && withNote.value.note).toBe('first lot');
    const without = validateTradeDraft({ ...good, noteText: '   ' });
    expect(without.ok && 'note' in without.value).toBe(false);
  });

  it('reports every problem at once, against the field it belongs to', () => {
    const result = validateTradeDraft({
      ...good,
      symbolText: 'a-b',
      quantityText: '',
      priceText: '0',
      feeText: 'abc',
      dateText: '2026-13-40',
    });

    expect(result).toEqual({
      ok: false,
      errors: {
        symbol: COPY.portfolio.symbolError,
        quantity: COPY.portfolio.quantityError,
        price: COPY.portfolio.priceError,
        fee: COPY.portfolio.feeError,
        date: COPY.portfolio.dateError,
      },
    });
  });

  it('refuses sizes the contract would', () => {
    const result = validateTradeDraft({ ...good, quantityText: '1000000001' });
    expect(result.ok).toBe(false);
  });
});

describe('draftFromTrade', () => {
  it('round-trips a trade through the form', () => {
    const trade = {
      id: 'x',
      symbol: 'FPT',
      side: 'sell' as const,
      quantity: 200,
      price: 120000,
      fee: 0,
      date: '2026-11-02',
      note: 'took profit',
      pending: false,
    };

    const result = validateTradeDraft(draftFromTrade(trade));

    expect(result).toEqual({
      ok: true,
      value: {
        symbol: 'FPT',
        side: 'sell',
        quantity: 200,
        price: 120000,
        fee: 0,
        date: '2026-11-02',
        note: 'took profit',
      },
    });
  });
});
