import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { StyleSheet } from 'react-native'
import { ArrowRightIcon, SpeedometerIcon, type Icon } from 'phosphor-react-native'

import { Button } from '@/components/base/Button'
import { BoardTopSpeedCard } from '@/modules/alerts/components/BoardTopSpeedCard'
import { MetricAlerts } from '@/modules/alerts/components/MetricAlerts'
import { ALERT_PRESET_METRIC_UNITS } from '@/modules/alerts/constants/metricLabels'
import { useDraftMetricAlerts, type DraftAlertSetup } from '@/modules/alerts/hooks/useMetricAlerts'
import { ALERT_PRESET_METRICS, type AlertPresetMetric } from '@/modules/alerts/lib/alertPresets'
import { theme } from '@/constants/theme'
import {
  WizardNavActions,
  WizardStepLayout,
} from '@/modules/board/components/add-board-wizard/WizardStepLayout'
import { ALERT_METRIC_META } from '@/modules/board/components/add-board-wizard/alertMetricMeta'
import type { UseAddBoardWizard } from '@/modules/board/hooks/useAddBoardWizard'

interface AlertSubstep {
  key: 'board-top-speed' | AlertPresetMetric
  title: string
  icon: Icon
}

const ALERT_SUBSTEPS: AlertSubstep[] = [
  { key: 'board-top-speed', title: 'Board top speed', icon: SpeedometerIcon },
  ...ALERT_PRESET_METRICS.map((metric) => ({
    key: metric,
    title: `${ALERT_METRIC_META[metric].name} alert`,
    icon: ALERT_METRIC_META[metric].icon,
  })),
]

export const ALERT_SUBSTEP_COUNT = ALERT_SUBSTEPS.length

export function AlertsStep({
  wizard,
  substepIndex,
  onSubstepIndexChange,
}: {
  wizard: UseAddBoardWizard
  substepIndex: number
  onSubstepIndexChange: Dispatch<SetStateAction<number>>
}) {
  const substep = ALERT_SUBSTEPS[substepIndex]!
  const isFirst = substepIndex === 0
  const isLast = substepIndex === ALERT_SUBSTEPS.length - 1
  const onBack = () => (isFirst ? wizard.back() : onSubstepIndexChange((current) => current - 1))
  const onNext = () => (isLast ? wizard.next() : onSubstepIndexChange((current) => current + 1))
  const description = isFirst
    ? 'The fastest you consider yourself capable of riding. Scales the speed gauge and alerts.'
    : 'Pick how loudly this metric warns you. Adjust it any time from its control on the main screen.'

  return (
    <WizardStepLayout
      title={substep.title}
      description={description}
      icon={substep.icon}
      color={theme.palette.amber.color}
      headerRight={
        <Button
          label="Skip"
          variant="accent"
          size="sm"
          icon={ArrowRightIcon}
          iconPosition="right"
          onPress={wizard.next}
          testID="add-board-skip-alerts"
          style={styles.skipButton}
        />
      }
      footer={
        <WizardNavActions
          canContinue
          onBack={onBack}
          onNext={onNext}
          nextLabel={isLast ? 'Done' : 'Next'}
          testIDPrefix="add-board-presets"
        />
      }
    >
      {isFirst ? (
        <BoardTopSpeedCard value={wizard.topSpeedKmh} onChange={wizard.setTopSpeedKmh} />
      ) : (
        <DraftMetricAlerts wizard={wizard} metric={substep.key as AlertPresetMetric} />
      )}
    </WizardStepLayout>
  )
}

function DraftMetricAlerts({
  wizard,
  metric,
}: {
  wizard: UseAddBoardWizard
  metric: AlertPresetMetric
}) {
  const { setAlertSetup } = wizard
  const onChange = useCallback(
    (setup: DraftAlertSetup) => setAlertSetup(metric, setup),
    [setAlertSetup, metric],
  )
  const controller = useDraftMetricAlerts(metric, {
    setup: wizard.alertSetup[metric],
    topSpeedKmh: wizard.topSpeedKmh,
    hasBatteryConfig: wizard.hasBatteryConfig,
    onChange,
  })

  return <MetricAlerts controller={controller} unit={ALERT_PRESET_METRIC_UNITS[metric]} />
}

const styles = StyleSheet.create({
  skipButton: {
    height: 28,
    paddingHorizontal: 10,
  },
})
