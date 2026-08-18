import { Pressable, StyleSheet, Switch, View } from 'react-native'
import { SirenIcon, SpeedometerIcon, WarningCircleIcon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'

interface LegalModeWidgetProps {
  value: boolean
  description: string
  warning: boolean
  onValueChange: (value: boolean) => void
  onWarningPress: () => void
}

export function LegalModeWidget({
  value,
  description,
  warning,
  onValueChange,
  onWarningPress,
}: LegalModeWidgetProps) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.legalModeCell,
        styles.legalModeWidget,
        value && styles.legalModeWidgetActive,
        pressed && styles.legalModeWidgetPressed,
      ]}
      accessibilityRole="switch"
      accessibilityLabel="Legal Mode"
      accessibilityState={{ checked: value }}
      onPress={() => onValueChange(!value)}
    >
      <SirenIcon size={22} color={theme.status.error.color} weight="duotone" />
      <View style={styles.legalModeText}>
        <View style={styles.legalModeTitleRow}>
          <Text style={styles.legalModeLabel} numberOfLines={1}>
            Legal mode
          </Text>
          {warning ? (
            <Pressable
              style={styles.legalWarningButton}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Legal road status warning"
              onPress={(event) => {
                event.stopPropagation()
                onWarningPress()
              }}
            >
              <WarningCircleIcon size={15} color={theme.status.error.color} weight="fill" />
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.legalModeDescription} numberOfLines={1}>
          {description}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{
          false: theme.palette.slate.border,
          true: theme.alpha(theme.status.error.color, 0.6),
        }}
        thumbColor={value ? theme.status.error.color : theme.palette.slate.textMuted}
        ios_backgroundColor={theme.palette.slate.border}
        accessibilityLabel="Legal Mode"
      />
    </Pressable>
  )
}

export function LegalMapWidget({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.legalMapWidget, pressed && styles.legalMapWidgetPressed]}
      accessibilityRole="button"
      accessibilityLabel="Legal limits map"
      onPress={onPress}
    >
      <SpeedometerIcon size={24} color={theme.palette.green.color} weight="duotone" />
      <View style={styles.legalMapText}>
        <Text style={styles.legalMapLabel} numberOfLines={1}>
          Map
        </Text>
        <Text style={styles.legalMapDescription} numberOfLines={1}>
          limits
        </Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  legalModeCell: {
    flex: 3,
    flexBasis: 0,
    minWidth: 0,
  },
  legalModeWidget: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  legalModeWidgetActive: {
    borderWidth: 1,
    borderColor: theme.status.error.border,
  },
  legalModeWidgetPressed: {
    backgroundColor: theme.palette.slate.surface,
  },
  legalModeTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legalModeLabel: {
    color: theme.palette.slate.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  legalModeText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  legalModeDescription: {
    color: theme.palette.slate.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  legalWarningButton: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.palette.slate.surfaceDeep,
    borderWidth: 1,
    borderColor: theme.status.error.border,
  },
  legalMapCell: {
    width: 82,
  },
  legalMapWidget: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 10,
  },
  legalMapWidgetPressed: {
    backgroundColor: theme.palette.slate.surface,
  },
  legalMapLabel: {
    color: theme.palette.slate.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  legalMapText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  legalMapDescription: {
    color: theme.palette.slate.textMuted,
    fontSize: 10,
    fontWeight: '700',
  },
  wideCell: {
    width: '100%',
  },
})
