import { Pressable, StyleSheet, View } from 'react-native'
import { ChatTextIcon, RadioactiveIcon, WaveformIcon, type Icon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import type { TelemetryAlertTab as AlertTab } from '@/modules/board/constants/telemetryThresholds'

interface AlertTypeTabOption {
  id: AlertTab
  label: string
  icon: Icon
  color: string
}

const ALERT_TYPE_OPTIONS: AlertTypeTabOption[] = [
  { id: 'single', label: 'Alert', icon: WaveformIcon, color: theme.palette.green.color },
  { id: 'geiger', label: 'Geiger', icon: RadioactiveIcon, color: theme.palette.orange.color },
  { id: 'message', label: 'Message', icon: ChatTextIcon, color: theme.palette.cyan.color },
] as const

const TRACK_WIDTH = 294

/** The alert-type tab bar: equal segments that fit their labels exactly, on a compact centered track. */
export function AlertTypeTabs({
  tab,
  onSelect,
}: {
  tab: AlertTab
  onSelect: (tab: AlertTab) => void
}) {
  return (
    <View style={styles.tabsContainer}>
      <View style={styles.track}>
        {ALERT_TYPE_OPTIONS.map((option, index) => {
          const active = option.id === tab
          const Icon = option.icon
          return (
            <Pressable
              key={option.id}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={option.label}
              style={[
                styles.segment,
                index > 0 && styles.segmentDivider,
                active && styles.segmentActive,
              ]}
              onPress={() => onSelect(option.id)}
            >
              <Icon
                size={16}
                color={active ? option.color : theme.control.textMuted}
                weight="duotone"
              />
              <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>
                {option.label}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  tabsContainer: {
    alignItems: 'center',
  },
  track: {
    width: TRACK_WIDTH,
    height: 38,
    borderRadius: 19,
    flexDirection: 'row',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.control.border,
    backgroundColor: theme.control.background,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 4,
    backgroundColor: theme.control.background,
  },
  segmentDivider: {
    borderLeftWidth: 1,
    borderLeftColor: theme.control.divider,
  },
  segmentActive: {
    backgroundColor: theme.neutral.surface,
  },
  segmentLabel: {
    color: theme.control.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  segmentLabelActive: {
    color: theme.neutral.textPrimary,
  },
})
