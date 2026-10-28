import { addedByText, labelOfMember, memberLabel, parseMembers } from '@/household/addedBy';

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

  it('keeps the day each member joined, which settling up needs', () => {
    const stored = [
      { ...ANA, joinedAt: '2026-10-01T09:00:00.000Z' },
      { ...BAO, joinedAt: '2026-10-05T09:00:00.000Z' },
    ];

    expect(parseMembers(JSON.stringify(stored))).toEqual(stored);
  });

  it('leaves joinedAt out for members stored before it was kept, rather than inventing one', () => {
    const [ana] = parseMembers(JSON.stringify([ANA]));

    expect(ana).toEqual(ANA);
    expect(ana).not.toHaveProperty('joinedAt');
  });

  it('ignores a joinedAt that is not text', () => {
    const [ana] = parseMembers(JSON.stringify([{ ...ANA, joinedAt: 5 }]));

    expect(ana).not.toHaveProperty('joinedAt');
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

describe('labelOfMember', () => {
  it('says you for the person looking, a name for a member, and a former member for anyone gone', () => {
    expect(labelOfMember([ANA, BAO], 'a', 'a')).toBe('You');
    expect(labelOfMember([ANA, BAO], 'a', 'b')).toBe('Bao.tran');
    expect(labelOfMember([ANA, BAO], 'a', 'gone')).toBe('Former member');
  });

  it('names everyone but a former member when nobody is looking', () => {
    expect(labelOfMember([ANA, BAO], null, 'a')).toBe('Ana');
  });
});
