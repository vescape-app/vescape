import type { Icon } from 'phosphor-react-native'
import { CaretRightIcon } from 'phosphor-react-native'
import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'

import { interaction, theme } from '@/constants/theme'

interface BoardSettingRowProps {
  icon: Icon
  iconColor: string
  label: string
  value: string
  hint?: string
  onPress: () => void
  testID?: string
}

export function BoardSettingRow({
  icon: IconComponent,
  iconColor,
  label,
  value,
  hint,
  onPress,
  testID,
}: BoardSettingRowProps) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      android_ripple={interaction.ripple}
      onPress={onPress}
      testID={testID}
    >
      <IconComponent size={18} color={iconColor} weight="duotone" />
      <View style={styles.copy}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value} numberOfLines={1}>
          {value}
        </Text>
        {hint ? (
          <Text style={styles.hint} numberOfLines={1}>
            {hint}
          </Text>
        ) : null}
      </View>
      <CaretRightIcon size={16} color={theme.palette.slate.color} weight="bold" />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowPressed: {
    backgroundColor: interaction.pressedBg,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  label: {
    color: theme.neutral.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  value: {
    color: theme.neutral.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  hint: {
    color: theme.neutral.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
})
