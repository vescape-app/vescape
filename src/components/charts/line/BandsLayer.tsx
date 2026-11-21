import { useMemo } from 'react'
import { Path, Skia } from '@shopify/react-native-skia'
import { useDerivedValue, type SharedValue } from 'react-native-reanimated'

import { projectX, viewportFor } from '@/components/charts/line/projection'
import type { ChartBand, ChartCamera, ChartPlotBox } from '@/components/charts/line/types'
import { useThemeStore } from '@/hooks/useTheme'
import { groupBands, type BandGroup } from '@/components/charts/line/bandGroups'

const BAND_HEIGHT = 1
const BAND_INSET = 1
const ROW_PITCH = BAND_HEIGHT + 1
const MIN_WIDTH = 2
const BAND_OPACITY = 0.85

export interface BandsLayerProps {
  bands: ChartBand[]
  plot: ChartPlotBox
  camera: SharedValue<ChartCamera>
  dataKey: string
  domainStartMs: number
  domainEndMs: number
}

export function BandsLayer({
  bands,
  plot,
  camera,
  dataKey,
  domainStartMs,
  domainEndMs,
}: BandsLayerProps) {
  const appearance = useThemeStore((state) => state.resolvedTheme)
  const groups = useMemo(() => groupBands(bands, appearance), [bands, appearance])

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
  'use no memo'
  const color = group.color
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

  return <Path path={path} color={color} opacity={wash ? 1 : BAND_OPACITY} />
}
