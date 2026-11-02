import { useEffect, useRef, useState, type RefObject } from 'react';
import { Keyboard, Platform, type View } from 'react-native';

/**
 * How far the keyboard covers the bottom of a view, in pixels, never negative.
 */
export function overlapOf(viewBottom: number, keyboardTop: number): number {
  return Math.max(0, Math.round(viewBottom) - Math.round(keyboardTop));
}

/**
 * Keeps a bottom-anchored form or sheet above the Android keyboard.
 *
 * Android now forces edge-to-edge, and in that mode the window is not resized when the keyboard opens, so
 * `KeyboardAvoidingView`'s `height`/`undefined` modes (which relied on the resize) leave a field under the
 * keyboard, and what was typed is out of sight. Rather than guess which mode a window is in, this measures:
 * when the keyboard opens it reads where the keyboard's top is and where the view's bottom is, and the
 * overlap is how much to lift the content (as bottom padding). If the system did resize the window, the view
 * already ends above the keyboard, the overlap is zero, and nothing is added twice.
 *
 * Attach `ref` to the view that fills the window (the screen, or the sheet's full-window root), and apply
 * `overlap` as its `paddingBottom`. On iOS, whose avoidance already works, it does nothing.
 */
export function useKeyboardOverlap(): {
  readonly ref: RefObject<View | null>;
  readonly overlap: number;
} {
  const ref = useRef<View | null>(null);
  const [overlap, setOverlap] = useState(0);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      const keyboardTop = event.endCoordinates.screenY;
      ref.current?.measureInWindow((_x, y, _width, height) => {
        setOverlap(overlapOf(y + height, keyboardTop));
      });
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setOverlap(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return { ref, overlap };
}
