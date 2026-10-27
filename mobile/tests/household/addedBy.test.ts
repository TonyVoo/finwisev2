import { addedByText, memberLabel, parseMembers } from '@/household/addedBy';

const ANA = { userId: 'a', email: 'ana@example.com' };
const BAO = { userId: 'b', email: 'bao.tran@example.com' };

describe('memberLabel', () => {
  it('is the part of the address before the @, with a capital', () => {
    expect(memberLabel('bao.tran@example.com')).toBe('Bao.tran');
    expect(memberLabel('ana@example.com')).toBe('Ana');
  });

  it('copes with an address that has no @', () => {
    expect(memberLabel('odd')).toBe('Odd');
  });
});

describe('parseMembers', () => {
  it('reads what the reconcile stored', () => {
    expect(parseMembers(JSON.stringify([ANA, BAO]))).toEqual([ANA, BAO]);
  });

  it('is empty for nothing, or for junk', () => {
    expect(parseMembers(null)).toEqual([]);
    expect(parseMembers('not json')).toEqual([]);
    expect(parseMembers('{"a":1}')).toEqual([]);
    expect(parseMembers(JSON.stringify([{ userId: 1 }]))).toEqual([]);
  });
});

describe('addedByText', () => {
  it('names the other person', () => {
    expect(addedByText('b', [ANA, BAO], 'ana@example.com')).toBe('Added by Bao.tran');
  });

  it('says "you" for the person looking', () => {
    expect(addedByText('a', [ANA, BAO], 'ana@example.com')).toBe('Added by you');
  });

  it('says nothing when the book is not shared, so a solo account sees no clutter', () => {
    expect(addedByText('a', [ANA], 'ana@example.com')).toBeNull();
    expect(addedByText('a', [], 'ana@example.com')).toBeNull();
  });

  it('says nothing for an expense with no recorded author, or one by someone who has gone', () => {
    expect(addedByText(null, [ANA, BAO], 'ana@example.com')).toBeNull();
    expect(addedByText('gone', [ANA, BAO], 'ana@example.com')).toBeNull();
  });
});
