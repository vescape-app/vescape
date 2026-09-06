import { Pressable, StyleSheet, Switch, View } from 'react-native'
import { Text } from '@/components/base/Text'

import { Button } from '@/components/base/Button'
import { theme } from '@/constants/theme'

interface ToggleRowProps {
  label: string
  value: boolean
  onToggle: (v: boolean) => void
}

export function ToggleRow({ label, value, onToggle }: ToggleRowProps) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.label}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: theme.neutral.border, true: theme.palette.sky.border }}
        thumbColor={value ? theme.palette.sky.color : theme.neutral.textMuted}
        style={styles.toggleSwitch}
      />
    </View>
  )
}

interface ChipRowProps {
  label: string
  options: string[]
  selected: string
  onSelect: (v: string) => void
}

export function ChipRow({ label, options, selected, onSelect }: ChipRowProps) {
  return (
    <View style={styles.chipRow}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.chips}>
        {options.map((o) => (
          <Pressable
            key={o}
            style={[styles.chip, o === selected && styles.chipActive]}
            onPress={() => onSelect(o)}
          >
            <Text style={[styles.chipText, o === selected && styles.chipTextActive]}>{o}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

interface ValueRowProps {
  label: string
  value: string | number
}

export function ValueRow({ label, value }: ValueRowProps) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.valueDisplay}>{value}</Text>
    </View>
  )
}

interface OpenButtonProps {
  label?: string
  onPress: () => void
}

export function OpenButton({ label = 'Open Modal', onPress }: OpenButtonProps) {
  return <Button label={label} onPress={onPress} size="sm" />
}

const styles = StyleSheet.create({
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 28,
  },
  label: {
    color: theme.neutral.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  toggleSwitch: {
    transform: [{ scaleX: 0.75 }, { scaleY: 0.75 }],
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    minHeight: 28,
    gap: 8,
  },
  chips: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 4,
  },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: theme.neutral.surfaceDeep,
    borderWidth: 1,
    borderColor: theme.neutral.border,
  },
  chipActive: {
    backgroundColor: theme.palette.sky.border,
    borderColor: theme.palette.sky.color,
  },
  chipText: {
    color: theme.neutral.textMuted,
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  chipTextActive: {
    color: theme.neutral.textPrimary,
  },
  valueDisplay: {
    color: theme.neutral.textPrimary,
    fontSize: 13,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
})
