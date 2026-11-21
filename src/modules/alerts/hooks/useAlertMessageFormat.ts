import { useCallback } from 'react'
import { useDistanceUnit } from '@/hooks/useDistanceUnit'
import type { DerivedBatteryConfig } from '@/modules/battery/lib/types'
import {
  renderPreviewTemplate,
  type getAlertDialConfig,
} from '@/modules/alerts/lib/alertFormDefaults'

export function useAlertMessageFormat() {
  const distanceUnit = useDistanceUnit()
  return useCallback(
    (
      template: string,
      threshold: number,
      unit: string,
      dialConfig: ReturnType<typeof getAlertDialConfig>,
      controlId: string,
      batteryConfig: DerivedBatteryConfig | null,
    ) =>
      renderPreviewTemplate(
        template,
        threshold,
        unit,
        dialConfig,
        controlId,
        batteryConfig,
        distanceUnit,
      ),
    [distanceUnit],
  )
}
