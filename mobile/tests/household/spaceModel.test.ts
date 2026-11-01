import type { Space } from '@expense-tracker/shared';
import { COPY } from '@/copy/strings';
import { activeSpaceOf, needsSwitcher, spaceName, switchRefusal } from '@/household/spaceModel';

const ME = '0192f5a0-0000-7000-8000-00000000a001';
const HOME = '0192f5a0-0000-7000-8000-00000000b001';

const personal: Space = { id: ME, kind: 'personal', name: null, currency: 'EUR' };
const home: Space = {
  id: HOME,
  kind: 'household',
  householdId: '0192f5a0-0000-7000-8000-00000000d001',
  name: 'Home',
  role: 'owner',
  currency: 'USD',
};

describe('spaceName', () => {
  it('calls the person’s own books Personal, and a household by its name', () => {
    expect(spaceName(personal)).toBe(COPY.spaces.personal);
    expect(spaceName(home)).toBe('Home');
  });
});

describe('activeSpaceOf', () => {
  it('is the space the store holds', () => {
    expect(activeSpaceOf([personal, home], HOME)).toBe(home);
  });

  it('falls back to the personal space for a scope that is not listed, or none', () => {
    expect(activeSpaceOf([personal, home], 'gone')).toBe(personal);
    expect(activeSpaceOf([home, personal], null)).toBe(personal);
  });

  it('falls back to the first when there is no personal space (an older household), and to none when empty', () => {
    expect(activeSpaceOf([home], null)).toBe(home);
    expect(activeSpaceOf([], null)).toBeNull();
  });
});

describe('needsSwitcher', () => {
  it('is only for a person with more than one space', () => {
    expect(needsSwitcher([])).toBe(false);
    expect(needsSwitcher([personal])).toBe(false);
    expect(needsSwitcher([personal, home])).toBe(true);
  });
});

describe('switchRefusal', () => {
  it('says to connect when offline, before it says to sync', () => {
    expect(switchRefusal({ pending: true, offline: true })).toBe(COPY.spaces.offline);
  });

  it('says to sync first when changes are waiting', () => {
    expect(switchRefusal({ pending: true, offline: false })).toBe(COPY.household.syncFirst);
  });

  it('is nothing when a switch can go ahead', () => {
    expect(switchRefusal({ pending: false, offline: false })).toBeNull();
  });
});
