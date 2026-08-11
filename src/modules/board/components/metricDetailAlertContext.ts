import { createContext, use } from 'react'

interface MetricDetailAlertContextValue {
  controlId: string
  thresholds: number[]
}

export const MetricDetailAlertContext = createContext<MetricDetailAlertContextValue | null>(null)

const NO_THRESHOLDS: number[] = []

/** Return alert thresholds only for the chart representing the layout's alert control. */
export function useMetricDetailAlertThresholds(controlId: string | undefined): number[] {
  const alerts = use(MetricDetailAlertContext)
  return alerts && alerts.controlId === controlId ? alerts.thresholds : NO_THRESHOLDS
}
