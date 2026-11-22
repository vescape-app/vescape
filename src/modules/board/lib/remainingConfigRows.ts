import { onOff, type ConfigRow } from '@/modules/board/lib/boardConfigReadout'

export function remainingConfigRows(
  values: Record<string, number | boolean | undefined> | undefined,
  coveredIds: ReadonlySet<string>,
): ConfigRow<string>[] {
  return Object.keys(values ?? {})
    .filter((id) => !coveredIds.has(id))
    .sort((a, b) => a.localeCompare(b))
    .map((id) => ({
      id,
      label: id,
      format: (value) =>
        typeof value === 'boolean' ? onOff(value) : value == null ? '—' : String(value),
    }))
}
