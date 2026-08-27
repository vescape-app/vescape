import { CaretLeftIcon, CaretRightIcon } from 'phosphor-react-native'
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { Text } from '@/components/base/Text'

import { interaction, theme } from '@/constants/theme'

interface PrevNextSelectorProps {
  label: string
  onPrevious: () => void
  onNext: () => void
  onSelect?: () => void
  selectControl?: ReactNode
  previousDisabled?: boolean
  nextDisabled?: boolean
  accessibilityLabel?: string
  style?: StyleProp<ViewStyle>
  previousTestID?: string
  nextTestID?: string
}

export function PrevNextSelector({
  label,
  onPrevious,
  onNext,
  onSelect,
  selectControl,
  previousDisabled = false,
  nextDisabled = false,
  accessibilityLabel = 'Select item',
  style,
  previousTestID,
  nextTestID,
}: PrevNextSelectorProps) {
  return (
    <View style={[styles.container, style]}>
      <NavButton
        label="Previous"
        disabled={previousDisabled}
        onPress={onPrevious}
        testID={previousTestID}
        icon={<CaretLeftIcon size={22} color={theme.control.icon} weight="bold" />}
      />
      <View style={styles.divider} />
      {selectControl ? (
        <View style={styles.select}>{selectControl}</View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          disabled={!onSelect}
          onPress={onSelect}
          android_ripple={interaction.ripple}
          style={({ pressed }) => [styles.select, pressed && onSelect && styles.pressed]}
        >
          <Text style={styles.selectText} numberOfLines={1}>
            {label}
          </Text>
        </Pressable>
      )}
      <View style={styles.divider} />
      <NavButton
        label="Next"
        disabled={nextDisabled}
        onPress={onNext}
        testID={nextTestID}
        icon={<CaretRightIcon size={22} color={theme.control.icon} weight="bold" />}
      />
    </View>
  )
}

function NavButton({
  label,
  icon,
  disabled,
  onPress,
  testID,
}: {
  label: string
  icon: ReactNode
  disabled: boolean
  onPress: () => void
  testID?: string
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      android_ripple={interaction.rippleBorderless}
      style={({ pressed }) => [
        styles.navButton,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      {icon}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  container: {
    height: 54,
    minWidth: 220,
    maxWidth: 320,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 27,
    borderWidth: 1,
    borderColor: theme.control.border,
    backgroundColor: theme.control.background,
    overflow: 'hidden',
  },
  navButton: {
    width: 54,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: {
    width: 1,
    height: 24,
    backgroundColor: theme.control.divider,
  },
  select: {
    flex: 1,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  selectText: {
    color: theme.control.text,
    fontSize: 13,
    fontWeight: '800',
  },
  pressed: {
    opacity: interaction.pressedOpacity,
  },
  disabled: {
    opacity: 0.35,
  },
})
