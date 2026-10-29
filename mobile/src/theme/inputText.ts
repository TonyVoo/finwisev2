import { type } from './tokens';

/**
 * The text of a single-line `TextInput`: the body face *without* its `lineHeight`.
 *
 * On iOS a `lineHeight` taller than the font (body is 24 on 16) makes the text sit at the bottom of its
 * line box, and a field sized for centred text has no room under it: the tails of g, y, p and q are cut
 * off while you type. Leaving `lineHeight` unset lets the field centre the text. Multi-line inputs keep
 * the full body style, since there the line height is what spaces the lines.
 */
export const singleLineInput = {
  fontSize: type.body.fontSize,
  fontWeight: type.body.fontWeight,
  letterSpacing: type.body.letterSpacing,
} as const;
