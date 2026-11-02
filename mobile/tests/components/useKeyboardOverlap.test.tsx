import { Keyboard, Platform, type KeyboardEvent, type View } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { overlapOf, useKeyboardOverlap } from '@/components/useKeyboardOverlap';

/**
 * Keeping a field above the Android keyboard (`useKeyboardOverlap`).
 *
 * With edge-to-edge, which Android forces on current versions, the window is no longer resized for the
 * keyboard, so a bottom-anchored form or sheet sits under it. The hook measures how far the keyboard
 * covers the bottom of a view and says how much to lift the content; it asks the screen rather than
 * assuming, so a window that *was* resized is not lifted twice.
 */

type Listener = (event: KeyboardEvent) => void;

let listeners: Record<string, Listener>;
const originalOS = Platform.OS;

function useAndroid(os: 'android' | 'ios' = 'android') {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
}

beforeEach(() => {
  listeners = {};
  jest.spyOn(Keyboard, 'addListener').mockImplementation(((name: string, listener: Listener) => {
    listeners[name] = listener;
    return { remove: () => delete listeners[name] };
  }) as never);
  useAndroid('android');
});
afterEach(() => {
  jest.restoreAllMocks();
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => originalOS });
});

/** A view that reports a bottom edge at `bottom` (window coordinates). */
function viewEndingAt(bottom: number): View {
  return {
    measureInWindow: (callback: (x: number, y: number, w: number, h: number) => void) =>
      callback(0, bottom - 800, 400, 800),
  } as unknown as View;
}

const keyboardAt = (screenY: number) =>
  ({ endCoordinates: { screenY, height: 900 - screenY } }) as KeyboardEvent;

describe('overlapOf', () => {
  it('is how far the keyboard covers the view’s bottom, never negative', async () => {
    expect(overlapOf(900, 620)).toBe(280);
    expect(overlapOf(900, 900)).toBe(0);
    // The window already shrank to sit above the keyboard.
    expect(overlapOf(600, 620)).toBe(0);
  });

  it('rounds to whole pixels', async () => {
    expect(overlapOf(900.4, 620.2)).toBe(280);
  });
});

describe('useKeyboardOverlap', () => {
  it('is zero until the keyboard opens', async () => {
    const { result } = await renderHook(() => useKeyboardOverlap());

    expect(result.current.overlap).toBe(0);
  });

  it('lifts by the part of the keyboard that covers the view, and drops back when it closes', async () => {
    const { result } = await renderHook(() => useKeyboardOverlap());
    result.current.ref.current = viewEndingAt(900);

    await act(async () => listeners.keyboardDidShow!(keyboardAt(620)));
    expect(result.current.overlap).toBe(280);

    await act(async () => listeners.keyboardDidHide!({} as KeyboardEvent));
    expect(result.current.overlap).toBe(0);
  });

  it('does not lift a window the system already resized above the keyboard', async () => {
    const { result } = await renderHook(() => useKeyboardOverlap());
    result.current.ref.current = viewEndingAt(620);

    await act(async () => listeners.keyboardDidShow!(keyboardAt(620)));

    expect(result.current.overlap).toBe(0);
  });

  it('follows the keyboard when its height changes', async () => {
    const { result } = await renderHook(() => useKeyboardOverlap());
    result.current.ref.current = viewEndingAt(900);

    await act(async () => listeners.keyboardDidShow!(keyboardAt(620)));
    await act(async () => listeners.keyboardDidShow!(keyboardAt(560)));

    expect(result.current.overlap).toBe(340);
  });

  it('does nothing on iOS, which already avoids the keyboard', async () => {
    useAndroid('ios');
    const { result } = await renderHook(() => useKeyboardOverlap());

    expect(listeners.keyboardDidShow).toBeUndefined();
    expect(result.current.overlap).toBe(0);
  });

  it('stops listening when it unmounts', async () => {
    const { unmount } = await renderHook(() => useKeyboardOverlap());

    await unmount();

    expect(listeners.keyboardDidShow).toBeUndefined();
    expect(listeners.keyboardDidHide).toBeUndefined();
  });
});
