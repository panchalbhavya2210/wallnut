import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/theme/theme';
import { AppText } from './ui/text';
import { Card } from './ui/layout';

/**
 * Per-widget error boundary.
 *
 * A release build without an error boundary crashes the whole app when a
 * single widget throws (a bad SVG prop, a missing native module, malformed
 * data). Wrapping each dashboard card keeps the rest of the screen usable and
 * shows a quiet retry card instead of a red screen.
 */

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

export class WidgetBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.warn('[widget] crashed:', error?.message ?? error);
  }

  render() {
    if (this.state.error) {
      return <WidgetFallback onRetry={() => this.setState({ error: null })} />;
    }
    return this.props.children;
  }
}

function WidgetFallback({ onRetry }: { onRetry: () => void }) {
  const theme = useTheme();
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <Ionicons name="alert-circle-outline" size={16} color={theme.colors.warning} />
        <AppText variant="label" tone="muted">
          CARD UNAVAILABLE
        </AppText>
      </View>
      <AppText variant="caption" tone="muted" style={{ marginTop: theme.spacing.sm }} numberOfLines={3}>
        This card hit a problem and was skipped. Everything else still works.
      </AppText>
      <Pressable onPress={onRetry} hitSlop={8} style={({ pressed }) => ({ marginTop: theme.spacing.sm, opacity: pressed ? 0.7 : 1 })}>
        <AppText variant="captionMedium" tone="accent">
          Try again
        </AppText>
      </Pressable>
    </Card>
  );
}
