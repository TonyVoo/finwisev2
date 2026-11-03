import { resolveSplit, type SplitDraft } from '@/expenses/splitModel';

const part = (categoryId: string | null, amountText: string): SplitDraft => ({
  categoryId,
  amountText,
});
const resolve = (total: number, drafts: SplitDraft[], decimals = 2) =>
  resolveSplit(total, drafts, decimals);

describe('dividing one amount between categories', () => {
  it('accepts parts that add up to the total exactly', () => {
    expect(resolve(50000, [part('food', '350'), part('home', '150')])).toEqual({
      status: 'ok',
      parts: [
        { categoryId: 'food', amountMinor: 35000 },
        { categoryId: 'home', amountMinor: 15000 },
      ],
      remainingMinor: 0,
    });
  });

  it('lets one part be left empty to take the rest', () => {
    expect(resolve(50000, [part('food', '350'), part('home', '')])).toMatchObject({
      status: 'ok',
      parts: [
        { categoryId: 'food', amountMinor: 35000 },
        { categoryId: 'home', amountMinor: 15000 },
      ],
    });
  });

  it('says how much is still to assign while it does not add up', () => {
    expect(resolve(50000, [part('food', '300'), part('home', '100')])).toEqual({
      status: 'invalid',
      reason: 'sum',
      remainingMinor: 10000,
    });
  });

  it('says how far over it is, as a negative remainder', () => {
    expect(resolve(50000, [part('food', '400'), part('home', '200')])).toEqual({
      status: 'invalid',
      reason: 'sum',
      remainingMinor: -10000,
    });
  });

  it('needs at least two parts', () => {
    expect(resolve(50000, [part('food', '500')])).toMatchObject({
      status: 'invalid',
      reason: 'parts',
    });
  });

  it('needs a category on every part, and no category twice', () => {
    expect(resolve(50000, [part('food', '300'), part(null, '200')])).toMatchObject({
      status: 'invalid',
      reason: 'category',
    });
    expect(resolve(50000, [part('food', '300'), part('food', '200')])).toMatchObject({
      status: 'invalid',
      reason: 'duplicate',
    });
  });

  it('refuses amounts that are not amounts, or zero, and only one empty part', () => {
    expect(resolve(50000, [part('food', 'lots'), part('home', '200')])).toMatchObject({
      status: 'invalid',
      reason: 'amount',
    });
    expect(resolve(50000, [part('food', '0'), part('home', '500')])).toMatchObject({
      status: 'invalid',
      reason: 'amount',
    });
    expect(resolve(50000, [part('food', ''), part('home', '')])).toMatchObject({
      status: 'invalid',
      reason: 'amount',
    });
  });

  it('an empty part cannot take a remainder that is zero or negative', () => {
    expect(resolve(50000, [part('food', '500'), part('home', '')])).toMatchObject({
      status: 'invalid',
      reason: 'amount',
    });
  });

  it('works in a currency with no minor unit', () => {
    expect(resolve(500000, [part('food', '350000'), part('home', '')], 0)).toMatchObject({
      status: 'ok',
      parts: [
        { categoryId: 'food', amountMinor: 350000 },
        { categoryId: 'home', amountMinor: 150000 },
      ],
    });
  });
});
