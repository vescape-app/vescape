import { TextTIcon } from 'phosphor-react-native'

import { theme } from '@/constants/theme'
import { BoardInfoForm } from '@/modules/board/components/BoardInfoForm'
import {
  WizardNavActions,
  WizardStepLayout,
} from '@/modules/board/components/add-board-wizard/WizardStepLayout'
import type { UseAddBoardWizard } from '@/modules/board/hooks/useAddBoardWizard'

export function NameStep({ wizard }: { wizard: UseAddBoardWizard }) {
  return (
    <WizardStepLayout
      title="Name your board"
      icon={TextTIcon}
      color={theme.palette.orange.color}
      footer={
        <WizardNavActions
          canContinue={Boolean(wizard.name.trim())}
          onBack={wizard.back}
          onNext={wizard.next}
          testIDPrefix="add-board-name"
        />
      }
    >
      <BoardInfoForm
        name={wizard.name}
        description={wizard.description}
        onChangeName={wizard.setName}
        onChangeDescription={wizard.setDescription}
        nameTestID="add-board-name-input"
        descriptionTestID="add-board-description-input"
      />
    </WizardStepLayout>
  )
}
