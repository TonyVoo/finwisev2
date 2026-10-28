import { startingPoint, suggestionWith } from '@/household/settleUpModel';

/**
 * Where the Settle up screen starts: with what you actually owe, since that is nearly always what
 * is being settled. Pure, so the choices are pinned without a screen.
 */

const ME = 'me';
const BAO = 'bao';
const CAM = 'cam';

describe('suggestionWith', () => {
  it('is what you owe them, when you are the one who owes', () => {
    expect(suggestionWith([{ fromUserId: ME, toUserId: BAO, amountMinor: 700 }], ME, BAO)).toEqual({
      iPaid: true,
      amountMinor: 700,
    });
  });

  it('is what they owe you, when they are the one who owes', () => {
    expect(suggestionWith([{ fromUserId: BAO, toUserId: ME, amountMinor: 900 }], ME, BAO)).toEqual({
      iPaid: false,
      amountMinor: 900,
    });
  });

  it('is nothing when the suggested transfers do not connect you to them', () => {
    expect(
      suggestionWith([{ fromUserId: CAM, toUserId: BAO, amountMinor: 900 }], ME, BAO),
    ).toBeNull();
    expect(suggestionWith([], ME, BAO)).toBeNull();
  });
});

describe('startingPoint', () => {
  const others = [BAO, CAM];

  it('starts with the first thing you owe', () => {
    expect(
      startingPoint(
        [
          { fromUserId: ME, toUserId: CAM, amountMinor: 300 },
          { fromUserId: ME, toUserId: BAO, amountMinor: 100 },
        ],
        ME,
        others,
      ),
    ).toEqual({ personId: CAM, iPaid: true, amountMinor: 300 });
  });

  it('otherwise starts with the first thing you are owed', () => {
    expect(
      startingPoint([{ fromUserId: BAO, toUserId: ME, amountMinor: 450 }], ME, others),
    ).toEqual({ personId: BAO, iPaid: false, amountMinor: 450 });
  });

  it('ignores what other members owe each other', () => {
    expect(
      startingPoint(
        [
          { fromUserId: CAM, toUserId: BAO, amountMinor: 999 },
          { fromUserId: BAO, toUserId: ME, amountMinor: 450 },
        ],
        ME,
        others,
      ),
    ).toEqual({ personId: BAO, iPaid: false, amountMinor: 450 });
  });

  it('starts empty, with the first other member, when nothing is owed', () => {
    expect(startingPoint([], ME, others)).toEqual({ personId: BAO, iPaid: true, amountMinor: 0 });
  });

  it('has nobody to start with when you are alone', () => {
    expect(startingPoint([], ME, [])).toBeNull();
  });
});
