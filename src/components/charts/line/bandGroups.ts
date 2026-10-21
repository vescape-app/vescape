import { resolveAdaptiveColor, type ResolvedTheme } from '@/constants/theme'
import type { ChartBand } from '@/components/charts/line/types'

/** Bands that can share a path: same colour, same row. */
export interface BandGroup {
  key: string
  color: string
  row: number
  fill: NonNullable<ChartBand['fill']>
  starts: number[]
  ends: number[]
}

export function groupBands(bands: ChartBand[], appearance: ResolvedTheme): BandGroup[] {
  const groups = new Map<string, BandGroup>()
  for (const band of bands) {
    const row = band.row ?? 0
    const fill = band.fill ?? 'floor'
    const color = resolveAdaptiveColor(band.color, appearance)
    const key = `${fill}|${row}|${color}`
    let group = groups.get(key)
    if (!group) {
      group = { key, color, row, fill, starts: [], ends: [] }
      groups.set(key, group)
    }
    group.starts.push(band.startMs)
    group.ends.push(band.endMs)
  }
  return [...groups.values()]
}
