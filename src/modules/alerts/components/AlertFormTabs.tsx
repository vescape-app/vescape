import { ChatTextIcon, RadioactiveIcon, WaveformIcon } from 'phosphor-react-native'
import { StyleSheet, TouchableOpacity, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import type { TelemetryAlertTab as AlertTab } from '@/modules/board/constants/telemetryThresholds'

/** Picks what kind of alert is being written: one beep, a Geiger range, or a spoken message. */
export function AlertFormTabs({
  tab,
  onSelect,
}: {
  tab: AlertTab
  onSelect: (tab: AlertTab) => void
}) {
  return (
    <View style={styles.tabRow}>
      <TouchableOpacity
        style={[styles.tab, tab === 'single' && styles.tabActive]}
        onPress={() => onSelect('single')}
      >
        <WaveformIcon
          size={14}
          color={tab === 'single' ? theme.neutral.textPrimary : theme.neutral.textMuted}
          weight="fill"
        />
        <Text style={[styles.tabText, tab === 'single' && styles.tabTextActive]}>Alert</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.tab, tab === 'geiger' && styles.tabActive]}
        onPress={() => onSelect('geiger')}
      >
        <RadioactiveIcon
          size={14}
          color={tab === 'geiger' ? theme.neutral.textPrimary : theme.neutral.textMuted}
          weight="fill"
        />
        <Text style={[styles.tabText, tab === 'geiger' && styles.tabTextActive]}>Geiger</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.tab, tab === 'message' && styles.tabActive]}
        onPress={() => onSelect('message')}
      >
        <ChatTextIcon
          size={14}
          color={tab === 'message' ? theme.neutral.textPrimary : theme.neutral.textMuted}
          weight="fill"
        />
        <Text style={[styles.tabText, tab === 'message' && styles.tabTextActive]}>Message</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  tabRow: {
    flexDirection: 'row',
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.neutral.surface,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    backgroundColor: theme.neutral.surfaceDeep,
  },
  tabActive: {
    backgroundColor: theme.palette.sky.bg,
  },
  tabText: {
    color: theme.neutral.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  tabTextActive: {
    color: theme.neutral.textPrimary,
  },
})
