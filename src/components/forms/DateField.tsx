import { useState } from 'react'
import { Platform, Pressable, StyleSheet, View } from 'react-native'
import DateTimePicker from '@expo/ui/community/datetime-picker'

import { Text } from '@/components/base/Text'
import { inputBase } from '@/components/forms/Input'
import { theme, type ThemeColor } from '@/constants/theme'
import { useResolvedColor, useResolvedControlColors } from '@/hooks/useTheme'

interface DateFieldProps {
  label: string
  value: Date
  onChange: (date: Date) => void
  minimumDate?: Date
  maximumDate?: Date
  accent?: ThemeColor
  testID?: string
}

const formatDate = (date: Date) =>
  date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * One labelled day picked with the system picker: iOS shows its compact calendar pill inline,
 * Android opens the Material date dialog from a tappable field.
 */
export function DateField({
  label,
  value,
  onChange,
  minimumDate,
  maximumDate,
  accent = theme.palette.sky.color,
  testID,
}: DateFieldProps) {
  const control = useResolvedControlColors()
  const accentColor = useResolvedColor(accent)
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <View style={styles.row} testID={testID}>
      <Text style={[styles.label, { color: control.textMuted }]}>{label}</Text>
      {Platform.OS === 'ios' ? (
        <DateTimePicker
          value={value}
          mode="date"
          display="compact"
          accentColor={accentColor}
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          onValueChange={(_event, date) => onChange(date)}
        />
      ) : (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${label} ${formatDate(value)}`}
            onPress={() => setDialogOpen(true)}
            style={[
              styles.field,
              { backgroundColor: control.background, borderColor: control.border },
            ]}
          >
            <Text style={[styles.value, { color: control.text }]}>{formatDate(value)}</Text>
          </Pressable>
          {dialogOpen ? (
            <DateTimePicker
              value={value}
              mode="date"
              presentation="dialog"
              accentColor={accentColor}
              minimumDate={minimumDate}
              maximumDate={maximumDate}
              onValueChange={(_event, date) => {
                setDialogOpen(false)
                onChange(date)
              }}
              onDismiss={() => setDialogOpen(false)}
            />
          ) : null}
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 44,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
  },
  field: {
    ...inputBase,
    paddingVertical: 8,
  },
  value: {
    fontSize: 15,
    fontWeight: '600',
  },
})
