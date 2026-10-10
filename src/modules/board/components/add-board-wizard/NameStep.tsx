import { TextTIcon } from 'phosphor-react-native'

import { theme } from '@/constants/theme'
import { BoardInfoForm } from '@/modules/board/components/BoardInfoForm'
import {
  WizardNavActions,
  WizardStepLayout,
} from '@/modules/board/components/add-board-wizard/WizardStepLayout'
import type { UseAddBoardWizard } from '@/modules/board/hooks/useAddBoardWizard'
import { BoardPersonalizer } from '@/modules/board/components/add-board-wizard/BoardPersonalizer'

export function NameStep({ wizard }: { wizard: UseAddBoardWizard }) {
  return (
    <WizardStepLayout
      title="Personalize your board"
      icon={TextTIcon}
      color={theme.palette.orange.color}
      revealBottomOnKeyboard
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
      <BoardPersonalizer
        railId={wizard.railId}
        railColorId={wizard.railColorId}
        onRailChange={wizard.setRailId}
        onRailColorChange={wizard.setRailColorId}
      />
    </WizardStepLayout>
  )
}
