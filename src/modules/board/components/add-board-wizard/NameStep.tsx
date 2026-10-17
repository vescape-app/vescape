import { TextTIcon } from 'phosphor-react-native'

import { theme } from '@/constants/theme'
import { BoardSetupSelector } from '@/modules/board/components/add-board-wizard/BoardSetupSelector'
import {
  WizardNavActions,
  WizardStepLayout,
} from '@/modules/board/components/add-board-wizard/WizardStepLayout'
import type { UseAddBoardWizard } from '@/modules/board/hooks/useAddBoardWizard'

export function NameStep({ wizard }: { wizard: UseAddBoardWizard }) {
  return (
    <WizardStepLayout
      title="Personalize your board"
      icon={TextTIcon}
      color={theme.palette.orange.color}
      alignContentTop
      footer={
        <WizardNavActions
          canContinue={Boolean(wizard.name.trim())}
          onBack={wizard.back}
          onNext={wizard.next}
          testIDPrefix="add-board-name"
        />
      }
    >
      <BoardSetupSelector wizard={wizard} />
    </WizardStepLayout>
  )
}
