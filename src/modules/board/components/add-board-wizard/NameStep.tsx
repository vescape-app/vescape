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
      color={theme.palette.yellow.color}
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
        onChangeName={wizard.setName}
        nameTestID="add-board-name-input"
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
