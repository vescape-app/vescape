import { StyleSheet } from 'react-native'
import { Text } from '@/components/base/Text'

import { theme } from '@/constants/theme'
import { formatFocusedSeriesCaption } from '@/modules/board/lib/focusedSeriesCaption'
import { useFocusedSeriesStore } from '@/modules/board/store/focusedSeriesStore'

/**
 * Tells the rider what the detail charts below are showing — the live window actually covered
 * and the measured packet rate. Renders nothing until a focused metric has delivered data, so
 * detail screens without a live chart stay clean.
 */
export function FocusedSeriesCaption() {
  const spanMs = useFocusedSeriesStore((s) => s.spanMs)
  const sampleRateHz = useFocusedSeriesStore((s) => s.sampleRateHz)
  const caption = formatFocusedSeriesCaption(spanMs, sampleRateHz)
  if (!caption) return null
  return <Text style={styles.caption}>{caption}</Text>
}

const styles = StyleSheet.create({
  caption: {
    color: theme.palette.slate.textSecondary,
    fontSize: 11,
    letterSpacing: 0.3,
  },
})
