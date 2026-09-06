import { createContext } from 'react'

interface MetricDetailAlertContextValue {
  controlId: string
  thresholds: number[]
}

export const MetricDetailAlertContext = createContext<MetricDetailAlertContextValue | null>(null)
