import { PulseIcon } from 'phosphor-react-native'
import { SectionHeader } from '@/components/base/SectionHeader'
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
    <SectionHeader
      icon={PulseIcon}
      color={theme.palette.blue.color}
      title={formatFocusedSeriesSpan(spanMs, configuredMinutes)}
      description={formatFocusedSeriesDetail(spanMs, sampleRateHz)}
    />
  )
}
