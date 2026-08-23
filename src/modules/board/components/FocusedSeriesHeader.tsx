import { PulseIcon } from 'phosphor-react-native'
import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import {
  formatFocusedSeriesDetail,
  formatFocusedSeriesSpan,
} from '@/modules/board/lib/focusedSeriesHeader'
import { useFocusedSeriesStore } from '@/modules/board/store/focusedSeriesStore'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'

/**
 * Heading of the detail charts, in the shape the Alerts block uses: icon, a short title, and a
 * line of detail under it. The title is the window actually covered — the charts below carry no
 * title of their own, so this is what names them.
 */
export function FocusedSeriesHeader() {
  const spanMs = useFocusedSeriesStore((s) => s.spanMs)
  const sampleRateHz = useFocusedSeriesStore((s) => s.sampleRateHz)
  const configuredMinutes = useSettingsStore((s) => s.liveHistoryLimit)

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <PulseIcon size={20} color={theme.palette.blue.color} weight="duotone" />
        <Text style={styles.title}>{formatFocusedSeriesSpan(spanMs, configuredMinutes)}</Text>
      </View>
      <Text style={styles.detail}>{formatFocusedSeriesDetail(spanMs, sampleRateHz)}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    gap: 2,
    paddingTop: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    color: theme.palette.slate.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  detail: {
    color: theme.palette.slate.textSecondary,
    fontSize: 11,
    letterSpacing: 0.3,
  },
})
