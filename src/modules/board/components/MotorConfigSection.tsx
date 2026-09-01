import {
  BoardConfigSection,
  type MotorConfigRow,
} from '@/modules/board/components/BoardConfigSection'
import { useMotorConfigFields } from '@/modules/board/store/motorConfigValuesStore'

/**
 * The VESC motor config (MCCONF) rows beside a `/control/<metric>` screen's live telemetry.
 *
 * A thin binding over {@link BoardConfigSection}: the section itself is config-agnostic, and every
 * screen showing motor config wants the same source, the same heading and the same empty state, so
 * they say it once here rather than each repeating the wiring.
 */
export function MotorConfigSection({ rows }: { rows: MotorConfigRow[] }) {
  const values = useMotorConfigFields()
  return (
    <BoardConfigSection
      title="Motor config"
      rows={rows}
      values={values}
      empty="No motor config read from this board yet. Connect it to read its limits."
    />
  )
}
