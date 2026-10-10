import { StyleSheet, View } from 'react-native'
import { ChatTextIcon, RadioactiveIcon, WaveformIcon } from 'phosphor-react-native'

import { PillSelector, PillSelectorItem } from '@/components/controls/PillSelector'
import { theme } from '@/constants/theme'
import type { TelemetryAlertTab as AlertTab } from '@/modules/board/constants/telemetryThresholds'

const ALERT_TYPE_OPTIONS = [
  { id: 'single', label: 'Alert', icon: WaveformIcon, color: theme.palette.green },
  { id: 'geiger', label: 'Geiger', icon: RadioactiveIcon, color: theme.palette.orange },
  { id: 'message', label: 'Message', icon: ChatTextIcon, color: theme.palette.cyan },
] as const

/** The alert-type tab bar, using the shared compact selector behavior. */
export function AlertTypeTabs({
  tab,
  onSelect,
}: {
  tab: AlertTab
  onSelect: (tab: AlertTab) => void
}) {
  return (
    <View style={styles.tabsContainer}>
      <PillSelector activeId={tab} contained fitContent showFullLabel variant="lightTabs">
        {ALERT_TYPE_OPTIONS.map((option) => (
          <PillSelectorItem
            key={option.id}
            id={option.id}
            label={option.label}
            icon={option.icon}
            color={option.color}
            activeWidth={96}
            onPress={() => onSelect(option.id)}
          />
        ))}
      </PillSelector>
    </View>
  )
}

const styles = StyleSheet.create({
  tabsContainer: {
    alignItems: 'center',
  },
})
