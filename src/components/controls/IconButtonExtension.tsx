import { useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { interaction, theme } from '@/constants/theme'

interface IconButtonExtensionProps {
  /** Shown above the button, inside the capsule. Null renders the button alone. */
  extension: ReactNode
  /** The round button the capsule grows out of, usually an `IconButton`. */
  children: ReactNode
  /** Makes the extension pressable, normally the same action as the button. */
  onPress?: () => void
  disabled?: boolean
  testID?: string
  accessibilityLabel?: string
}

/**
 * Grows a round button upward into a translucent capsule of the button's own width, holding any
 * content. The button keeps every one of its own props; the capsule only wraps it.
 */
export function IconButtonExtension({
  extension,
  children,
  onPress,
  disabled = false,
  testID,
  accessibilityLabel,
}: IconButtonExtensionProps) {
  // The capsule takes the button's width, so content never widens it, whatever the button size.
  const [width, setWidth] = useState<number>()
  if (extension == null) return children

  return (
    <View style={[styles.capsule, width != null && { width: width + 2, borderRadius: width }]}>
      <Pressable
        testID={testID}
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        disabled={disabled || !onPress}
        style={({ pressed }) => [
          styles.extension,
          disabled && styles.disabled,
          pressed && { opacity: interaction.pressedOpacity },
        ]}
      >
        {extension}
      </Pressable>
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>{children}</View>
    </View>
  )
}

interface IconButtonExtensionStatProps {
  value: string
  unit: string
}

/** A small value-over-unit readout sized for an extension. */
export function IconButtonExtensionStat({ value, unit }: IconButtonExtensionStatProps) {
  return (
    <View style={styles.stat}>
      <Text numberOfLines={1} adjustsFontSizeToFit style={styles.value}>
        {value}
      </Text>
      <Text style={styles.unit}>{unit}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  capsule: {
    alignSelf: 'flex-start',
    alignItems: 'center',
    // Outset by the border so the button inside stays exactly where it would sit alone.
    margin: -1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.control.border,
    backgroundColor: theme.alpha(theme.control.background, 0.6),
  },
  extension: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: 6,
    paddingTop: 14,
    paddingBottom: 8,
    paddingHorizontal: 4,
  },
  disabled: {
    opacity: 0.35,
  },
  stat: {
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  value: {
    alignSelf: 'stretch',
    textAlign: 'center',
    color: theme.alpha(theme.control.text, 0.8),
    fontFamily: 'monospace',
    fontSize: 16,
  },
  unit: {
    color: theme.control.textMuted,
    fontSize: 9,
    fontWeight: '600',
    marginTop: -2,
  },
})
