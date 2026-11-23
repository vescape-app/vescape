import type { ThemeColor } from '@/constants/theme'
export interface ChartSeriesData {
  ts: number[]
  vs: number[]
}

export interface ChartViewport {
  startMs: number
  endMs: number
}

export interface ChartYRange {
  min: number
  max: number
}

export interface ChartCamera {
  spanMs: number
  endMs: number | null
  key: string | null
}

export interface ChartColorStop<Color = ThemeColor> {
  value: number
  color: Color
}

export interface ChartColorRamp<Color = ThemeColor> {
  stops: ChartColorStop<Color>[]
  mode?: 'smooth' | 'bands'
}

export interface ChartTimeRange {
  startMs: number
  endMs: number
}

export interface ChartBand extends ChartTimeRange {
  color: ThemeColor
  row?: number
  fill?: 'floor' | 'plot'
}

export interface ChartSeriesSpec {
  displayScale?: number
  displayOffset?: number
  key: string
  data: ChartSeriesData
  color: ThemeColor
  axis?: 'left' | 'right'
  ramp?: ChartColorRamp
  label?: string
  unit?: string
  decimals?: number
}

export interface ChartAxisSpec {
  displayScale?: number
  displayOffset?: number
  range: ChartYRange
}

export interface ChartSpec {
  key: string
  label?: string
  height: number
  series: ChartSeriesSpec[]
  left: ChartAxisSpec
  right?: ChartAxisSpec
  bands?: ChartBand[]
  thresholds?: number[]
}

export interface ChartPlotBox {
  x: number
  y: number
  width: number
  height: number
}

export interface ChartPlotBand {
  top: number
  bottom: number
}
