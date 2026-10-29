import { singleLineInput } from '@/theme/inputText';
import { type } from '@/theme/tokens';

/**
 * Text for a single-line `TextInput`: the body face without its `lineHeight`. A `lineHeight` taller than
 * the font makes iOS draw the text low in the field and clip the descenders of g, y, p and q.
 */
describe('singleLineInput', () => {
  it('is the body face, so inputs still look like the rest of the app', () => {
    expect(singleLineInput.fontSize).toBe(type.body.fontSize);
    expect(singleLineInput.fontWeight).toBe(type.body.fontWeight);
    expect(singleLineInput.letterSpacing).toBe(type.body.letterSpacing);
  });

  it('has no lineHeight', () => {
    expect('lineHeight' in singleLineInput).toBe(false);
  });
});
