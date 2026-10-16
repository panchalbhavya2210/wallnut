import React, { useMemo, useState } from 'react';
import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Chip } from '@/components/ui/controls';
import { Row } from '@/components/ui/layout';
import { AppText } from '@/components/ui/text';
import { PickerSheet } from '@/components/ui/sheets';
import { useTheme } from '@/theme/theme';
import { monthCycleBuckets } from '@/utils/date';

/**
 * Month-on-month cycle picker: a pill showing the cycle ("October 2026") that
 * opens a sheet with the current cycle plus the ones before it. `value` is the
 * offset in cycles back from the current one (0 = this cycle); a "This cycle"
 * chip appears whenever a past cycle is selected so one tap resets.
 *
 * Shared by the Category trends page and the category detail's month-on-month
 * card — keep the two experiences identical.
 */
export function MonthCyclePicker({
  monthStartDay,
  value,
  onChange,
  label,
  cycles = 25,
}: {
  monthStartDay: number;
  value: number;
  onChange: (offset: number) => void;
  /** Cycle name shown on the pill, e.g. "October 2026". */
  label: string;
  cycles?: number;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  const options = useMemo(() => {
    const buckets = monthCycleBuckets(new Date(), cycles, monthStartDay);
    return buckets
      .slice()
      .reverse()
      .map((bucket, index) => ({
        id: String(index),
        label: bucket.fullLabel,
        subtitle: index === 0 ? 'This cycle' : undefined,
      }));
  }, [cycles, monthStartDay]);

  return (
    <>
      <Row gap="sm" align="center" wrap>
        <Pressable
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`Change month — ${label}`}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            paddingHorizontal: theme.spacing.sm + 2,
            paddingVertical: 5,
            borderRadius: theme.radius.full,
            backgroundColor: theme.colors.inputBackground,
            borderWidth: 1,
            borderColor: theme.colors.border,
          }}>
          <AppText variant="label" tone="muted">
            {label.toUpperCase()}
          </AppText>
          <Ionicons name="chevron-down" size={13} color={theme.colors.muted} />
        </Pressable>
        {value > 0 ? <Chip label="This cycle" size="sm" onPress={() => onChange(0)} /> : null}
      </Row>

      <PickerSheet
        visible={open}
        onClose={() => setOpen(false)}
        title="View month"
        items={options}
        selectedId={String(value)}
        onSelect={(item) => {
          onChange(Number(item.id));
          setOpen(false);
        }}
      />
    </>
  );
}
