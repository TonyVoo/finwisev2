import { addedByText, memberLabel, parseMembers } from '@/household/addedBy';

const ANA = { userId: 'a', email: 'ana@example.com', displayName: null };
const BAO = { userId: 'b', email: 'bao.tran@example.com', displayName: null };

describe('memberLabel', () => {
  it('prefers the name the person chose', () => {
    expect(memberLabel({ email: 'bao.tran@example.com', displayName: 'Bảo' })).toBe('Bảo');
  });

  it('falls back to the part of the address before the @, with a capital', () => {
    expect(memberLabel({ email: 'bao.tran@example.com', displayName: null })).toBe('Bao.tran');
    expect(memberLabel({ email: 'ana@example.com' })).toBe('Ana');
  });

  it('treats a blank name as none', () => {
    expect(memberLabel({ email: 'ana@example.com', displayName: '   ' })).toBe('Ana');
  });

  it('copes with an address that has no @', () => {
    expect(memberLabel({ email: 'odd', displayName: null })).toBe('Odd');
  });
});

describe('parseMembers', () => {
  it('reads what the reconcile stored', () => {
    expect(parseMembers(JSON.stringify([ANA, BAO]))).toEqual([ANA, BAO]);
  });

  it('reads members stored before display names existed, with no name', () => {
    expect(parseMembers(JSON.stringify([{ userId: 'a', email: 'ana@example.com' }]))).toEqual([
      { userId: 'a', email: 'ana@example.com', displayName: null },
    ]);
  });

  it('is empty for nothing, or for junk', () => {
    expect(parseMembers(null)).toEqual([]);
    expect(parseMembers('not json')).toEqual([]);
    expect(parseMembers('{"a":1}')).toEqual([]);
    expect(parseMembers(JSON.stringify([{ userId: 1 }]))).toEqual([]);
  });
});

describe('addedByText', () => {
  it('names the other person, by their display name when they have one', () => {
    expect(addedByText('b', [ANA, BAO], 'ana@example.com')).toBe('Added by Bao.tran');
    expect(addedByText('b', [ANA, { ...BAO, displayName: 'Bảo' }], 'ana@example.com')).toBe(
      'Added by Bảo',
    );
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
