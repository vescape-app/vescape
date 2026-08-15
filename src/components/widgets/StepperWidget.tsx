import { StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { CaretDownIcon, CaretUpIcon, type Icon } from 'phosphor-react-native'

import { IconButton } from '@/components/base/IconButton'
import { widgetSurface, type WidgetSize } from '@/components/widgets/widgetSurface'
import { theme } from '@/constants/theme'

interface StepperWidgetProps {
  icon?: Icon
  label: string
  previousIcon?: Icon
  nextIcon?: Icon
  accent?: string
  size?: Extract<WidgetSize, 'half' | 'full'>
  disabled?: boolean
  previousAccessibilityLabel?: string
  nextAccessibilityLabel?: string
  onPrevious: () => void
  onNext: () => void
}

/** A widget with two explicit actions at the trailing edge, useful for nudge controls. */
export function StepperWidget({
  icon: IconComponent,
  label,
  previousIcon = CaretDownIcon,
  nextIcon = CaretUpIcon,
  accent = theme.control.textMuted,
  size = 'full',
  disabled,
  previousAccessibilityLabel = `${label} back`,
  nextAccessibilityLabel = `${label} forward`,
  onPrevious,
  onNext,
}: StepperWidgetProps) {
  return (
    <View style={[styles.widget, size === 'half' && styles.half, disabled && styles.disabled]}>
      {IconComponent ? <IconComponent size={22} color={accent} weight="duotone" /> : null}
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.actions}>
        <IconButton
          icon={previousIcon}
          disabled={disabled}
          onPress={onPrevious}
          accessibilityLabel={previousAccessibilityLabel}
        />
        <IconButton
          icon={nextIcon}
          disabled={disabled}
          onPress={onNext}
          accessibilityLabel={nextAccessibilityLabel}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  widget: {
    ...widgetSurface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
  },
  half: {
    minHeight: 64,
  },
  disabled: {
    opacity: 0.45,
  },
  label: {
    flex: 1,
    minWidth: 0,
    color: theme.control.text,
    fontSize: 15,
    fontWeight: '700',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
})
