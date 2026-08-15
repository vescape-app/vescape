import { Canvas, Circle, RoundedRect } from '@shopify/react-native-skia'
import { useDerivedValue, type DerivedValue } from 'react-native-reanimated'

import { MonoText, TEXT_LINE_RATIO } from '@/components/base/MonoValue'
import { theme } from '@/constants/theme'
import type { BmsCellGroup, BmsSummary } from '@/modules/battery/lib'

const COLOR_MIN = theme.status.warning.color
const COLOR_MAX = theme.palette.yellow.color
const COLOR_NORMAL = theme.palette.green.color
const DOT_COLOR = theme.palette.green.color

export function groupColor(extreme: BmsCellGroup['extreme']): string {
  'worklet'
  return extreme === 'min' ? COLOR_MIN : extreme === 'max' ? COLOR_MAX : COLOR_NORMAL
}

/** Gap between columns in a row, and between stat slots. */
export const COL_GAP = 8

const INDEX_WIDTH = 14
const INDEX_FONT_SIZE = 8
const VALUE_WIDTH = 42
const VALUE_FONT_SIZE = 9
const ROW_HEIGHT = 12
const ROW_GAP = 3
const BAR_HEIGHT = 2
const DOT_RADIUS = 2

const STAT_VALUE_FONT_SIZE = 14
export const STAT_VALUE_HEIGHT = Math.ceil(STAT_VALUE_FONT_SIZE * TEXT_LINE_RATIO)

export interface BmsStatValue {
  text: DerivedValue<string>
  color: string
}

/**
 * One canvas for a whole row of stat values. Each readout used to own a canvas,
 * which is a native surface apiece for numbers that only tick with BMS frames.
 */
export function BmsStatValues({ values, width }: { values: BmsStatValue[]; width: number }) {
  const slot = (width - (values.length - 1) * COL_GAP) / values.length
  return (
    <Canvas style={{ width, height: STAT_VALUE_HEIGHT }} pointerEvents="none">
      {values.map((value, index) => (
        <MonoText
          key={index}
          text={value.text}
          size={STAT_VALUE_FONT_SIZE}
          weight="800"
          color={value.color}
          align="center"
          x={index * (slot + COL_GAP)}
          y={0}
          width={slot}
          height={STAT_VALUE_HEIGHT}
        />
      ))}
    </Canvas>
  )
}

interface CellRowsProps {
  groupCount: number
  summary: DerivedValue<BmsSummary | null>
  scale: DerivedValue<{ low: number; high: number }>
  width: number
}

/** Height the rows block occupies, so callers can reserve space before layout. */
export const cellRowsHeight = (groupCount: number) =>
  groupCount * ROW_HEIGHT + Math.max(0, groupCount - 1) * ROW_GAP

/**
 * Every cell group on a single canvas.
 *
 * The bars used to be views animating a percentage `width`, which is a layout
 * prop: each BMS frame ran a Yoga pass per row, and each row also carried its
 * own readout canvas. A pack can be 20+ groups, so that was 20+ native surfaces
 * relaid out on every frame. Here it is one surface and a repaint.
 */
export function BmsCellRows({ groupCount, summary, scale, width }: CellRowsProps) {
  const trackX = INDEX_WIDTH + COL_GAP
  const trackWidth = Math.max(0, width - trackX - COL_GAP - VALUE_WIDTH)

  return (
    <Canvas style={{ width, height: cellRowsHeight(groupCount) }} pointerEvents="none">
      {Array.from({ length: groupCount }, (_, index) => (
        <CellRowLayer
          key={index}
          index={index}
          summary={summary}
          scale={scale}
          trackX={trackX}
          trackWidth={trackWidth}
          valueX={width - VALUE_WIDTH}
        />
      ))}
    </Canvas>
  )
}

function CellRowLayer({
  index,
  summary,
  scale,
  trackX,
  trackWidth,
  valueX,
}: {
  index: number
  summary: DerivedValue<BmsSummary | null>
  scale: DerivedValue<{ low: number; high: number }>
  trackX: number
  trackWidth: number
  valueX: number
}) {
  const top = index * (ROW_HEIGHT + ROW_GAP)
  const centerY = top + ROW_HEIGHT / 2
  const label = `${index + 1}`

  const indexText = useDerivedValue(() => label)
  const barWidth = useDerivedValue(() => {
    const group = summary.value?.groups[index]
    if (!group) return 0
    const { low, high } = scale.value
    const span = high - low
    const fraction = Math.max(0, Math.min(1, (group.voltage - low) / (span > 0 ? span : 1)))
    return fraction * trackWidth
  })
  const cellColor = useDerivedValue(() => groupColor(summary.value?.groups[index]?.extreme ?? null))
  const dotOpacity = useDerivedValue(() => (summary.value?.groups[index]?.balancing ? 1 : 0))
  const voltageText = useDerivedValue(() => {
    const group = summary.value?.groups[index]
    return group ? `${group.voltage.toFixed(3)}V` : ''
  })

  return (
    <>
      <MonoText
        text={indexText}
        size={INDEX_FONT_SIZE}
        weight="600"
        color={theme.palette.slate.textDim}
        align="right"
        x={0}
        y={top}
        width={INDEX_WIDTH}
        height={ROW_HEIGHT}
      />
      <RoundedRect
        x={trackX}
        y={centerY - BAR_HEIGHT / 2}
        width={barWidth}
        height={BAR_HEIGHT}
        r={BAR_HEIGHT / 2}
        color={cellColor}
      />
      <Circle
        cx={trackX + trackWidth - DOT_RADIUS}
        cy={centerY}
        r={DOT_RADIUS}
        color={DOT_COLOR}
        opacity={dotOpacity}
      />
      <MonoText
        text={voltageText}
        size={VALUE_FONT_SIZE}
        color={cellColor}
        align="right"
        x={valueX}
        y={top}
        width={VALUE_WIDTH}
        height={ROW_HEIGHT}
      />
    </>
  )
}
