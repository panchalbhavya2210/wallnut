import React from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

/**
 * Horizontal page swiping for tabbed screens.
 *
 * The parent pan activates at ±32 px and fails vertically at ±12 px, while a
 * chart's own scrub pan activates at ±8 px. Starting a drag on a chart therefore
 * keeps chart scrubbing; starting anywhere else changes the page. No animation
 * is attached to the page itself — React state swaps the tab body and the
 * shared-axis transition is owned by the caller/content.
 */
export function SwipePager({
  index,
  count,
  onIndexChange,
  children,
}: {
  index: number;
  count: number;
  onIndexChange: (index: number) => void;
  children: React.ReactNode;
}) {
  const go = React.useCallback(
    (direction: -1 | 1) => {
      const next = Math.min(count - 1, Math.max(0, index + direction));
      if (next !== index) onIndexChange(next);
    },
    [count, index, onIndexChange],
  );

  const pan = React.useMemo(
    () =>
      Gesture.Pan()
        .enabled(count > 1)
        .activeOffsetX([-32, 32])
        .failOffsetY([-12, 12])
        .onEnd((event) => {
          if (event.translationX <= -48 || event.velocityX <= -650) runOnJS(go)(1);
          else if (event.translationX >= 48 || event.velocityX >= 650) runOnJS(go)(-1);
        }),
    [count, go],
  );

  return (
    <GestureDetector gesture={pan} touchAction="pan-y">
      <View style={{ flex: 1 }}>{children}</View>
    </GestureDetector>
  );
}
