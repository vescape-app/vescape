import { BoardConfigSection } from '@/modules/board/components/BoardConfigSection'
import type { MotorConfigRow } from '@/modules/board/lib/boardConfigReadout'
import {
  useMotorConfigFields,
  useMotorConfigValuesStore,
} from '@/modules/board/store/motorConfigValuesStore'

export function MotorConfigSection({ rows }: { rows: MotorConfigRow[] }) {
  const values = useMotorConfigFields()
  const error = useMotorConfigValuesStore((state) => state.error)
  return (
    <BoardConfigSection
      title="Motor config"
      rows={rows}
      values={values}
      error={error}
      empty="No motor config read from this board yet. Connect it to read its limits."
    />
  )
}
