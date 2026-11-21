import { useEffect, useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import type { BmsEvent, BmsSeriesFrame } from 'vescape-core'
import {
  useDerivedValue,
  useSharedValue,
  type DerivedValue,
  type SharedValue,
} from 'react-native-reanimated'
import { BatteryVerticalHighIcon, BatteryWarningVerticalIcon } from 'phosphor-react-native'

import { Placeholder } from '@/components/base/Placeholder'
import { SectionHeader } from '@/components/base/SectionHeader'
import { Text } from '@/components/base/Text'

import {
  cellBarScale,
  cellSpreadTone,
  summarizeBms,
  summarizeBmsWindow,
  type BmsSummary,
  type BmsWindowStats,
} from '@/modules/battery/lib'
import {
  BmsCellRows,
  BmsStatValues,
  COL_GAP,
  type BmsStatValue,
} from '@/modules/battery/components/bmsCellCanvas'
import { useCanvasSize } from '@/hooks/useCanvasSize'
import { useRenderRateWarning } from '@/hooks/useRenderRateWarning'
import { useBleStore } from '@/modules/board/store/bleStore'
import { telemetry } from '@/modules/board/constants/telemetry'
import { useBoardStore } from '@/modules/board/store/boardStore'
import { resolveAdaptiveColor, theme, type ThemeColor } from '@/constants/theme'
import { useThemeStore } from '@/hooks/useTheme'

function formatWindowLabel(windowMs: number | null | undefined): string {
  if (!windowMs) return 'WINDOW'
  const minutes = Math.round(windowMs / 60_000)
  if (minutes >= 1) return `${minutes} MIN`
  return `${Math.round(windowMs / 1000)} SEC`
}

function nearestTimeIndex(times: number[], timeMs: number): number {
  'worklet'
  const count = times.length
  if (count === 0) return -1
  let lo = 0
  let hi = count - 1
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (times[mid] < timeMs) lo = mid + 1
    else hi = mid
  }
  if (lo === 0) return 0
  const prev = lo - 1
  return Math.abs(times[prev] - timeMs) <= Math.abs(times[lo] - timeMs) ? prev : lo
}

export function BmsCellVoltages({
  scrubTimeMs,
  windowMs,
}: {
  scrubTimeMs?: SharedValue<number | null>
  windowMs?: number
}) {
  useRenderRateWarning('BmsCellVoltages')
  const bmsSeriesWindowMs = useBleStore((s) => s.bmsSeriesWindowMs)
  const groupCount = useBleStore((s) => s.latestBms?.cellVoltages.length ?? 0)
  const bmsLinked = useBoardStore(
    (s) => s.boards.find((b) => b.id === s.activeBoardId)?.link?.hasBms === true,
  )

  const liveSummarySV = useSharedValue<BmsSummary | null>(null)
  const windowStatsSV = useSharedValue<BmsWindowStats | null>(null)
  const frameTimesSV = useSharedValue<number[]>([])
  const frameCellsSV = useSharedValue<number[]>([])
  const frameBalancingSV = useSharedValue<number[]>([])
  const frameCellCountSV = useSharedValue(0)
  useEffect(() => {
    let lastLatest: BmsEvent | null | undefined
    let lastSeries: BmsSeriesFrame[] | undefined
    const apply = (state: ReturnType<typeof useBleStore.getState>) => {
      if (state.latestBms !== lastLatest) {
        lastLatest = state.latestBms
        liveSummarySV.value = summarizeBms(state.latestBms)
      }
      if (state.bmsSeries !== lastSeries) {
        lastSeries = state.bmsSeries
        windowStatsSV.value = summarizeBmsWindow(state.bmsSeries)
        const cellCount = state.bmsSeries.at(-1)?.cellVoltages.length ?? 0
        const times: number[] = []
        const cells: number[] = []
        const balancing: number[] = []
        for (const frame of state.bmsSeries) {
          if (frame.cellVoltages.length !== cellCount) continue
          times.push(frame.capturedAt)
          for (let i = 0; i < cellCount; i += 1) {
            cells.push(frame.cellVoltages[i])
            balancing.push(frame.balancing[i] ? 1 : 0)
          }
        }
        frameCellCountSV.value = cellCount
        frameTimesSV.value = times
        frameCellsSV.value = cells
        frameBalancingSV.value = balancing
      }
    }
    apply(useBleStore.getState())
    return useBleStore.subscribe(apply)
  }, [liveSummarySV, windowStatsSV, frameTimesSV, frameCellsSV, frameBalancingSV, frameCellCountSV])

  const summarySV = useDerivedValue<BmsSummary | null>(() => {
    const cursor = scrubTimeMs?.value ?? null
    if (cursor == null) return liveSummarySV.value
    const times = frameTimesSV.value
    const idx = nearestTimeIndex(times, cursor)
    if (idx < 0) return liveSummarySV.value
    const cellCount = frameCellCountSV.value
    const cells = frameCellsSV.value
    const balancingFlags = frameBalancingSV.value
    const start = idx * cellCount
    const cellVoltages: number[] = []
    const balancing: boolean[] = []
    for (let i = 0; i < cellCount; i += 1) {
      cellVoltages.push(cells[start + i])
      balancing.push(balancingFlags[start + i] === 1)
    }
    return summarizeBms({ cellVoltages, balancing })
  })

  if (groupCount === 0) {
    return (
      <View style={styles.container}>
        <SectionHeader
          icon={BatteryVerticalHighIcon}
          color={CELL_SECTION_COLOR}
          title="Cell balance"
        />
        <Placeholder
          icon={BatteryWarningVerticalIcon}
          description={
            bmsLinked
              ? 'Waiting for the first cell reading from the smart BMS.'
              : 'No smart BMS detected. Re-link a board with a BMS on the CAN bus to see per-cell voltages.'
          }
          style={styles.placeholder}
        />
      </View>
    )
  }

  return (
    <BmsCellCard
      groupCount={groupCount}
      summary={summarySV}
      windowStats={windowStatsSV}
      windowLabel={formatWindowLabel(bmsSeriesWindowMs ?? windowMs)}
    />
  )
}

export function BmsCellVoltagesView({
  summary,
  windowStats,
  windowMs,
}: {
  summary: BmsSummary
  windowStats?: BmsWindowStats | null
  windowMs?: number | null
}) {
  const summarySV = useDerivedValue<BmsSummary | null>(() => summary)
  const windowStatsSV = useDerivedValue<BmsWindowStats | null>(() => windowStats ?? null)

  return (
    <BmsCellCard
      groupCount={summary.cellCount}
      summary={summarySV}
      windowStats={windowStatsSV}
      windowLabel={formatWindowLabel(windowMs)}
    />
  )
}

function statColor(tone: 'min' | 'max' | 'neutral'): ThemeColor {
  return tone === 'min'
    ? theme.status.warning.text
    : tone === 'max'
      ? theme.palette.yellow.text
      : theme.neutral.textPrimary
}

function useSpreadColor(spread: DerivedValue<number | null>): DerivedValue<string> {
  const appearance = useThemeStore((state) => state.resolvedTheme)
  const ramp = useMemo(
    () => ({
      ok: resolveAdaptiveColor(theme.palette.green.text, appearance),
      warn: resolveAdaptiveColor(theme.status.warning.text, appearance),
      critical: resolveAdaptiveColor(theme.status.error.text, appearance),
    }),
    [appearance],
  )
  return useDerivedValue(() => {
    const v = spread.value
    return v == null ? ramp.ok : ramp[cellSpreadTone(v)]
  })
}

interface BmsCellCardProps {
  groupCount: number
  summary: DerivedValue<BmsSummary | null>
  windowStats: DerivedValue<BmsWindowStats | null>
  windowLabel: string
}

function BmsCellCard({ groupCount, summary, windowStats, windowLabel }: BmsCellCardProps) {
  const { size, onLayout } = useCanvasSize()

  const scale = useDerivedValue(() => {
    const s = summary.value
    return s ? cellBarScale(s.minVoltage, s.maxVoltage) : { low: 0, high: 1 }
  })

  const spreadText = useDerivedValue(() => {
    const s = summary.value
    return s ? `${s.spread.toFixed(3)}V` : '--'
  })
  const minText = useDerivedValue(() => {
    const s = summary.value
    return s ? `${s.minVoltage.toFixed(3)}V` : '--'
  })
  const avgText = useDerivedValue(() => {
    const s = summary.value
    return s ? `${s.average.toFixed(3)}V` : '--'
  })
  const maxText = useDerivedValue(() => {
    const s = summary.value
    return s ? `${s.maxVoltage.toFixed(3)}V` : '--'
  })
  const peakSpreadText = useDerivedValue(() => {
    const stats = windowStats.value
    return stats ? `${stats.peakSpread.toFixed(3)}V` : '--'
  })
  const worstGroupText = useDerivedValue(() => {
    const stats = windowStats.value
    return stats?.worstGroupIndex == null ? '--' : `G${stats.worstGroupIndex + 1}`
  })

  const spreadColor = useSpreadColor(useDerivedValue(() => summary.value?.spread ?? null))
  const peakSpreadColor = useSpreadColor(
    useDerivedValue(() => windowStats.value?.peakSpread ?? null),
  )

  const summaryStats: BmsStatValue[] = [
    { text: spreadText, color: spreadColor },
    { text: minText, color: statColor('min') },
    { text: avgText, color: statColor('neutral') },
    { text: maxText, color: statColor('max') },
  ]
  const windowStatValues: BmsStatValue[] = [
    { text: peakSpreadText, color: peakSpreadColor },
    { text: worstGroupText, color: statColor('min') },
  ]

  return (
    <View style={styles.container} onLayout={onLayout}>
      <SectionHeader
        icon={BatteryVerticalHighIcon}
        color={CELL_SECTION_COLOR}
        title="Cell balance"
        description={`${groupCount}S pack`}
      />
      <StatBlock labels={['Δ SPREAD', 'MIN', 'AVG', 'MAX']} values={summaryStats} width={size.w} />
      <StatBlock
        labels={[`PEAK Δ (${windowLabel})`, 'WORST GROUP']}
        values={windowStatValues}
        width={size.w}
      />
      {size.w > 0 ? (
        <BmsCellRows groupCount={groupCount} summary={summary} scale={scale} width={size.w} />
      ) : null}
    </View>
  )
}

function StatBlock({
  labels,
  values,
  width,
}: {
  labels: string[]
  values: BmsStatValue[]
  width: number
}) {
  return (
    <View style={styles.statBlock}>
      <View style={styles.statLabelRow}>
        {labels.map((label) => (
          <Text key={label} style={styles.statLabel}>
            {label}
          </Text>
        ))}
      </View>
      {width > 0 ? <BmsStatValues values={values} width={width} /> : null}
    </View>
  )
}

const CELL_SECTION_COLOR = telemetry.battVoltage.color

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  placeholder: {
    paddingVertical: 18,
  },
  statBlock: {
    gap: 2,
  },
  statLabelRow: {
    flexDirection: 'row',
    gap: COL_GAP,
  },
  statLabel: {
    flex: 1,
    textAlign: 'center',
    color: theme.neutral.textMuted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
})
