import { searchItems } from '@/helpers/search'
import { boardConfigSearchKeywords } from '@/modules/board/constants/boardConfigSearchKeywords'
import type { BoardConfigGroup } from '@/modules/board/constants/boardConfigTabs'

type Source = BoardConfigGroup['source']

interface SearchTab {
  id: string
  label: string
  groups: BoardConfigGroup[]
}

interface BoardConfigSearchGroup extends BoardConfigGroup {
  tabId: string
}

export function searchBoardConfig(
  tabs: SearchTab[],
  query: string,
  loadedSources: readonly Source[],
): BoardConfigSearchGroup[] {
  const ordered = [
    ...tabs.filter((tab) => tab.id !== 'quick'),
    ...tabs.filter((tab) => tab.id === 'quick'),
  ]
  const seen = new Set<string>()
  const entries: {
    tab: SearchTab
    group: BoardConfigGroup
    row: BoardConfigGroup['rows'][number]
  }[] = []

  for (const tab of ordered) {
    for (const group of tab.groups) {
      if (!loadedSources.includes(group.source)) continue
      for (const row of group.rows) {
        const key = `${group.source}:${row.id}`
        if (seen.has(key)) continue
        seen.add(key)
        entries.push({ tab, group, row })
      }
    }
  }

  const hits = searchItems(entries, query, ({ tab, group, row }) => {
    const keywords = boardConfigSearchKeywords(group.source, row.id)
    return [
      { text: row.label, weight: 10, fuzzy: true, phrase: true },
      ...keywords.map((keyword) => ({ text: keyword, weight: 8, fuzzy: true, phrase: true })),
      { text: row.id, weight: 6, fuzzy: false },
      { text: `${tab.label} ${group.title}`, weight: 3, fuzzy: true },
      { text: `${row.description ?? ''} ${row.when ?? ''}`, weight: 2, fuzzy: false },
    ]
  })

  const groups = new Map<string, BoardConfigSearchGroup>()
  for (const { item: hit } of hits) {
    const key = `${hit.tab.id}|${hit.group.source}|${hit.group.title}`
    const existing = groups.get(key)
    if (existing) existing.rows.push(hit.row)
    else
      groups.set(key, {
        title: `${hit.tab.label} · ${hit.group.title}`,
        source: hit.group.source,
        tabId: hit.tab.id,
        rows: [hit.row],
      })
  }
  return [...groups.values()]
}
