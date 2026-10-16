import { useEffect, useState } from 'react';
import { Keyboard, Platform, type KeyboardEvent } from 'react-native';

/**
 * Tracks the on-screen keyboard height.
 *
 * Modals on Android create their own window, so `adjustResize` alone does not
 * lift sheets that contain inputs — the keyboard simply covers them. Listening
 * to the keyboard events and padding the sheet ourselves is the reliable
 * cross-platform fix. Web returns 0 (the browser handles this itself).
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = (event: KeyboardEvent) => {
      const next = event.endCoordinates?.height ?? 0;
      // Ignore tiny values reported by some Android keyboards (e.g. hardware
      // keyboard hints); a real soft keyboard is at least ~120dp.
      setHeight(next > 80 ? next : 0);
    };
    const onHide = () => setHeight(0);

    const showSub = Keyboard.addListener(showEvent, onShow);
    const hideSub = Keyboard.addListener(hideEvent, onHide);
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return height;
}
