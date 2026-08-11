import { useState, type RefObject } from 'react'
import type { ScrollView } from 'react-native'

import {
  ALERT_SUBSTEP_COUNT,
  AlertsStep,
} from '@/modules/board/components/add-board-wizard/AlertsStep'
import { BatteryStep } from '@/modules/board/components/add-board-wizard/BatteryStep'
import { ConfirmStep } from '@/modules/board/components/add-board-wizard/ConfirmStep'
import { NameStep } from '@/modules/board/components/add-board-wizard/NameStep'
import { ScanStep } from '@/modules/board/components/add-board-wizard/ScanStep'
import { WizardProgress } from '@/modules/board/components/add-board-wizard/WizardProgress'
import type { UseAddBoardWizard } from '@/modules/board/hooks/useAddBoardWizard'

interface Props {
  wizard: UseAddBoardWizard
  onLinkActiveStepIndexChange?: (index: number) => void
  scrollRef?: RefObject<ScrollView | null>
}

export function AddBoardWizard({ wizard, onLinkActiveStepIndexChange, scrollRef }: Props) {
  const [alertSubstepIndex, setAlertSubstepIndex] = useState(0)

  return (
    <>
      <WizardProgress
        steps={wizard.steps}
        step={wizard.step}
        alertSubstep={
          wizard.stepId === 'presets'
            ? { index: alertSubstepIndex, total: ALERT_SUBSTEP_COUNT }
            : undefined
        }
      />
      {wizard.stepId === 'scan' && (
        <ScanStep
          wizard={wizard}
          scrollRef={scrollRef}
          onLinkActiveStepIndexChange={onLinkActiveStepIndexChange}
        />
      )}
      {wizard.stepId === 'name' && <NameStep wizard={wizard} />}
      {wizard.stepId === 'battery' && <BatteryStep wizard={wizard} />}
      {wizard.stepId === 'presets' && (
        <AlertsStep
          wizard={wizard}
          substepIndex={alertSubstepIndex}
          onSubstepIndexChange={setAlertSubstepIndex}
        />
      )}
      {wizard.stepId === 'confirm' && <ConfirmStep wizard={wizard} />}
    </>
  )
}
