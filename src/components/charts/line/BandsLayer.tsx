import { useMemo } from 'react'
import { Path, Skia } from '@shopify/react-native-skia'
import { useDerivedValue, type SharedValue } from 'react-native-reanimated'

import { projectX, viewportFor } from '@/components/charts/line/projection'
import type { ChartBand, ChartCamera, ChartPlotBox } from '@/components/charts/line/types'
import { useResolvedColor } from '@/hooks/useTheme'

/** A hairline, clear of the plot floor, with the next row stacked just above it. */
const BAND_HEIGHT = 1
const BAND_INSET = 1
const ROW_PITCH = BAND_HEIGHT + 1
/** A band shorter than this would vanish at low zoom; it is widened so it stays findable. */
const MIN_WIDTH = 2
const BAND_OPACITY = 0.85

/** Bands that can share a path: same colour, same row. */
interface BandGroup {
  key: string
  color: string
  row: number
  fill: NonNullable<ChartBand['fill']>
  starts: number[]
  ends: number[]
}

function groupBands(bands: ChartBand[]): BandGroup[] {
  const groups = new Map<string, BandGroup>()
  for (const band of bands) {
    const row = band.row ?? 0
    const fill = band.fill ?? 'floor'
    const key = `${fill}|${row}|${band.color}`
    let group = groups.get(key)
    if (!group) {
      group = { key, color: band.color, row, fill, starts: [], ends: [] }
      groups.set(key, group)
    }
    group.starts.push(band.startMs)
    group.ends.push(band.endMs)
  }
  return [...groups.values()]
}

export interface BandsLayerProps {
  bands: ChartBand[]
  plot: ChartPlotBox
  camera: SharedValue<ChartCamera>
  dataKey: string
  domainStartMs: number
  domainEndMs: number
}

/**
 * Time ranges marked out along the floor of a plot, in plot coordinates.
 *
 * Drawn from the camera like everything else on the canvas, so bands pan and zoom with the line
 * they annotate without any JS work per frame. Only the bands that overlap the viewport reach
 * the path.
 */
export function BandsLayer({
  bands,
  plot,
  camera,
  dataKey,
  domainStartMs,
  domainEndMs,
}: BandsLayerProps) {
  const groups = useMemo(() => groupBands(bands), [bands])

  return (
    <>
      {groups.map((group) => (
        <BandGroupPath
          key={group.key}
          group={group}
          plot={plot}
          camera={camera}
          dataKey={dataKey}
          domainStartMs={domainStartMs}
          domainEndMs={domainEndMs}
        />
      ))}
    </>
  )
}

interface BandGroupPathProps extends Omit<BandsLayerProps, 'bands'> {
  group: BandGroup
}

function BandGroupPath({
  group,
  plot,
  camera,
  dataKey,
  domainStartMs,
  domainEndMs,
}: BandGroupPathProps) {
  // See SeriesLayer: derived values and React Compiler memoisation do not mix.
  'use no memo'
  const color = useResolvedColor(group.color)
  const { starts, ends } = group
  const wash = group.fill === 'plot'
  const height = wash ? plot.height : BAND_HEIGHT
  const y = wash ? 0 : plot.height - BAND_INSET - BAND_HEIGHT - group.row * ROW_PITCH

  const path = useDerivedValue(() => {
    const built = Skia.Path.Make()
    if (plot.width <= 0) return built
    const viewport = viewportFor(camera.value, dataKey, domainStartMs, domainEndMs)
    for (let i = 0; i < starts.length; i += 1) {
      const left = projectX(starts[i], viewport, plot.width)
      const right = projectX(ends[i], viewport, plot.width)
      if (right < 0 || left > plot.width) continue
      built.addRect(Skia.XYWHRect(left, y, Math.max(right - left, MIN_WIDTH), height))
    }
    return built
  }, [camera, dataKey, domainEndMs, domainStartMs, ends, height, plot.width, starts, y])

  // A wash carries its own alpha; the hairlines are solid marks that only need to sit back a little.
  return <Path path={path} color={color} opacity={wash ? 1 : BAND_OPACITY} />
}
