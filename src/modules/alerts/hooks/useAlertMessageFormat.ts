import { useCallback } from 'react'
import { useUnitSystem } from '@/hooks/useUnitSystem'
import type { DerivedBatteryConfig } from '@/modules/battery/lib/types'
import {
  renderPreviewTemplate,
  type getAlertDialConfig,
} from '@/modules/alerts/lib/alertFormDefaults'

/** Format alert speech previews with the rider's current display units. */
export function useAlertMessageFormat() {
  const units = useUnitSystem()
  return useCallback(
    (
      template: string,
      threshold: number,
      unit: string,
      dialConfig: ReturnType<typeof getAlertDialConfig>,
      controlId: string,
      batteryConfig: DerivedBatteryConfig | null,
    ) =>
      renderPreviewTemplate(template, threshold, unit, dialConfig, controlId, batteryConfig, units),
    [units],
  )
}
