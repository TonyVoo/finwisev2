import { balanceLines } from '@/household/balanceLines';

/**
 * The lines the Balances section shows: who owes whom, worded from the point of view of the person
 * looking. Pure, so the wording rules are pinned without a screen.
 */

const ME = 'me';
const BAO = 'bao';
const CAM = 'cam';
const label = (id: string) => ({ me: 'Ana', bao: 'Bao', cam: 'Cam' })[id] ?? 'Former member';
const money = (minor: number) => `$${(minor / 100).toFixed(2)}`;
const lines = (transfers: Parameters<typeof balanceLines>[0]['transfers']) =>
  balanceLines({ transfers, meId: ME, labelOf: label, format: money });

describe('balanceLines', () => {
  it('says everyone is settled when nothing is owed', () => {
    expect(lines([])).toEqual([{ kind: 'settled', key: 'settled', text: 'All settled up' }]);
  });

  it('says what you owe, to whom', () => {
    expect(lines([{ fromUserId: ME, toUserId: BAO, amountMinor: 4200 }])).toEqual([
      {
        kind: 'youOwe',
        key: 'me>bao',
        text: 'You owe Bao $42.00',
        otherUserId: BAO,
        amountMinor: 4200,
      },
    ]);
  });

  it('says what you are owed, and by whom', () => {
    expect(lines([{ fromUserId: BAO, toUserId: ME, amountMinor: 1250 }])).toEqual([
      {
        kind: 'owesYou',
        key: 'bao>me',
        text: 'Bao owes you $12.50',
        otherUserId: BAO,
        amountMinor: 1250,
      },
    ]);
  });

  it('puts the lines about you first, and shows what others owe each other after', () => {
    const result = lines([
      { fromUserId: CAM, toUserId: BAO, amountMinor: 300 },
      { fromUserId: ME, toUserId: BAO, amountMinor: 700 },
      { fromUserId: BAO, toUserId: ME, amountMinor: 100 },
    ]);

    expect(result.map((line) => line.text)).toEqual([
      'You owe Bao $7.00',
      'Bao owes you $1.00',
      'Cam owes Bao $3.00',
    ]);
    expect(result.map((line) => line.kind)).toEqual(['youOwe', 'owesYou', 'owes']);
  });

  it('names someone who has left as a former member', () => {
    expect(lines([{ fromUserId: 'gone', toUserId: ME, amountMinor: 500 }])[0]?.text).toBe(
      'Former member owes you $5.00',
    );
  });

  it('keeps the order it was given within each group', () => {
    const result = lines([
      { fromUserId: ME, toUserId: BAO, amountMinor: 900 },
      { fromUserId: ME, toUserId: CAM, amountMinor: 100 },
    ]);

    expect(result.map((line) => line.text)).toEqual(['You owe Bao $9.00', 'You owe Cam $1.00']);
  });
});
