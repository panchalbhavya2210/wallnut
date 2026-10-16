import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Link, Stack } from 'expo-router';

import { useTheme } from '@/theme/theme';
import { Screen } from '@/components/ui/layout';
import { AppText } from '@/components/ui/text';
import { Button } from '@/components/ui/controls';

/**
 * Friendly 404. Deep links and stale bookmarks land here instead of a
 * developer error page.
 */
export default function NotFoundScreen() {
  const theme = useTheme();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen edges="top">
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.lg }}>
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: theme.radius.xl,
              backgroundColor: theme.colors.neutralSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <Ionicons name="compass-outline" size={28} color={theme.colors.muted} />
          </View>
          <View style={{ alignItems: 'center', gap: theme.spacing.sm }}>
            <AppText variant="title">This screen doesn't exist</AppText>
            <AppText variant="bodySmall" tone="muted" style={{ textAlign: 'center', maxWidth: 280 }}>
              The link you followed doesn't match anything in Wallnut. Your data is untouched — head back and carry on.
            </AppText>
          </View>
          <Link href="/" asChild>
            <Button label="Go to dashboard" />
          </Link>
        </View>
      </Screen>
    </>
  );
}
