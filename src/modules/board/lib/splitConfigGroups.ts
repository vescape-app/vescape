import type { BoardConfigGroup } from '@/modules/board/constants/boardConfigTabs'

/** Small tabs stay fully visible. Large tabs hide only deliberately marked setup/detail fields. */
export function splitConfigGroups(groups: BoardConfigGroup[]) {
  const primary: BoardConfigGroup[] = []
  const advanced: BoardConfigGroup[] = []
  for (const group of groups) {
    const isAdvanced = (id: string) =>
      group.advanced || (group.primaryIds !== undefined && !group.primaryIds.includes(id))
    const commonRows = group.rows.filter((row) => !isAdvanced(row.id))
    const detailRows = group.rows.filter((row) => isAdvanced(row.id))
    if (commonRows.length) primary.push({ ...group, rows: commonRows })
    if (detailRows.length) advanced.push({ ...group, rows: detailRows })
  }
  const advancedCount = advanced.reduce((count, group) => count + group.rows.length, 0)
  const totalCount = groups.reduce((count, group) => count + group.rows.length, 0)
  // A short tab, or a disclosure hiding only one or two fields, adds more work than it saves.
  return totalCount > 12 && advancedCount >= 4 && primary.length > 0
    ? { primary, advanced, advancedCount }
    : { primary: groups, advanced: [], advancedCount: 0 }
}
