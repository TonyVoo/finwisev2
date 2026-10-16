import { Dimensions } from 'react-native';

/**
 * The text scale the components read through `useWindowDimensions().fontScale`.
 *
 * ### Why this file exists
 *
 * React Native's jest preset reports a window of `fontScale: 2` - double size, which on a
 * device means a user who has dragged the accessibility text slider most of the way up.
 * It is not a considered default, it is the same fixture as `width: 750, scale: 2`, and
 * nothing in the preset suggests a test is meant to notice it.
 *
 * But three components branch on this value. Left alone, **every** case in the suite
 * asserts the large-text layout and no case asserts the ordinary one: the Summary's donut
 * drops its centre label above 1.5, its legend stacks each row above 1.3, and the amount
 * hero on the expense form shrinks above 1.4. A screen could lose its centre label at
 * normal size and the suite would still be green, because the suite never renders at
 * normal size.
 *
 * So {@link DEFAULT_FONT_SCALE} is applied before each test and the large-text layouts are
 * opted into, one case at a time, by name. That way the default layout is the one under
 * test by default, and dynamic type is tested because a case says it is - not by accident.
 */

/** What a device reports with the text slider untouched, and the baseline here. */
export const DEFAULT_FONT_SCALE = 1;

/** The jest preset's own value, kept only so a case can say it is choosing it. */
export const LARGE_FONT_SCALE = 2;

const BASE_WINDOW = Dimensions.get('window');
const BASE_SCREEN = Dimensions.get('screen');

/**
 * Set the text scale for the next render.
 *
 * `Dimensions.set` emits the change event `useWindowDimensions` subscribes to, so calling
 * this on an already-mounted tree re-renders it - wrap that call in `act` as you would any
 * other external state change. Called before a render, it simply decides the first frame.
 */
export function setFontScale(fontScale: number): void {
  Dimensions.set({
    window: { ...BASE_WINDOW, fontScale },
    screen: { ...BASE_SCREEN, fontScale },
  });
}
