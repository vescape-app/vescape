import { forwardRef } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { WarningIcon, type Icon } from 'phosphor-react-native'

import type { BasicSliderItem } from '@/modules/tune/lib/sliderDefinitions'
import { clamp, formatSliderValue } from '@/modules/tune/lib/sliderDefinitions'
import { TuneTileFill } from '@/modules/tune/components/TuneTileFill'
import { theme } from '@/constants/theme'

interface BasicSliderCellProps {
  item: BasicSliderItem
  icon: Icon
  color: string
  editable: boolean
  onPress: () => void
  onResetFormula?: () => void
}

export const BasicSliderCell = forwardRef<View, BasicSliderCellProps>(function BasicSliderCell(
  { item, icon: IconComponent, color, editable, onPress, onResetFormula },
  ref,
) {
  const progress =
    item.value == null ? 0 : clamp(((item.value - item.min) / (item.max - item.min)) * 100, 0, 100)

  return (
    <View ref={ref} style={styles.wrapper}>
      <Pressable
        style={[
          styles.cell,
          item.value == null && styles.cellMissing,
          !editable && styles.cellReadOnly,
        ]}
        onPress={editable ? onPress : undefined}
      >
        <TuneTileFill fraction={progress / 100} color={color} />
        {item.modifiedManually ? (
          <Pressable style={styles.alertButton} onPress={onResetFormula} hitSlop={8}>
            <WarningIcon size={16} color={theme.palette.yellow.color} weight="duotone" />
          </Pressable>
        ) : null}
        <View style={styles.headerRow}>
          <View style={[styles.labelRow, item.modifiedManually && styles.labelRowWithAlert]}>
            <IconComponent size={15} color={color} weight="duotone" />
            <Text style={styles.label} numberOfLines={1}>
              {item.label}
            </Text>
          </View>
        </View>
        <Text
          style={[styles.value, { color }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          pointerEvents="none"
        >
          {formatSliderValue(item)}
        </Text>
      </Pressable>
    </View>
  )
})

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
  },
  cell: {
    minHeight: 82,
    paddingTop: 7,
    paddingBottom: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.control.border,
    backgroundColor: theme.control.background,
    overflow: 'hidden',
  },
  cellMissing: {
    opacity: 0.58,
  },
  cellReadOnly: {
    borderColor: theme.control.border,
  },
  alertButton: {
    position: 'absolute',
    top: 7,
    right: 8,
    zIndex: 1,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  value: {
    position: 'absolute',
    right: 10,
    bottom: 4,
    fontSize: 22,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
    maxWidth: '58%',
    textAlign: 'right',
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    flex: 1,
    minWidth: 0,
  },
  labelRowWithAlert: {
    paddingRight: 26,
  },
  label: {
    color: theme.control.text,
    fontSize: 13,
    fontWeight: '800',
    flex: 1,
  },
})
