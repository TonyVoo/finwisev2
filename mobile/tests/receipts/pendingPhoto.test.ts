import { clearStashedPhoto, peekStashedPhoto, stashPhoto } from '@/receipts/pendingPhoto';

describe('the photo waiting for the Add expense form', () => {
  afterEach(() => clearStashedPhoto());

  it('is nothing until a photo is taken', () => {
    expect(peekStashedPhoto()).toBeNull();
  });

  it('is the photo just taken, readable more than once until it is cleared', () => {
    stashPhoto('AAAA');

    expect(peekStashedPhoto()).toBe('AAAA');
    expect(peekStashedPhoto()).toBe('AAAA');

    clearStashedPhoto();
    expect(peekStashedPhoto()).toBeNull();
  });

  it('is replaced by a newer photo, never queued behind it', () => {
    stashPhoto('AAAA');
    stashPhoto('BBBB');

    expect(peekStashedPhoto()).toBe('BBBB');
  });
});
