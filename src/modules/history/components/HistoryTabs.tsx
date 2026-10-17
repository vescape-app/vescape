import { ClockCounterClockwiseIcon, StarIcon } from 'phosphor-react-native'
import { PillSelector, PillSelectorItem } from '@/components/controls/PillSelector'
import { theme } from '@/constants/theme'

interface HistoryTabsProps {
  tab: 'history' | 'favorites'
  onSelectTab: (tab: 'history' | 'favorites') => void
}

/** Shared compact tabs: only the active destination shows its label. */
export function HistoryTabs({ tab, onSelectTab }: HistoryTabsProps) {
  return (
    <PillSelector activeId={tab} contained fitContent variant="lightTabs">
      <PillSelectorItem
        id="history"
        label="History"
        icon={ClockCounterClockwiseIcon}
        activeWidth={116}
        inactiveWidth={46}
        color={theme.palette.purple}
        testID="history-tab-history"
        onPress={() => onSelectTab('history')}
      />
      <PillSelectorItem
        id="favorites"
        label="Favorites"
        icon={StarIcon}
        activeWidth={126}
        inactiveWidth={46}
        color={theme.palette.amber}
        testID="history-tab-favorites"
        onPress={() => onSelectTab('favorites')}
      />
    </PillSelector>
  )
}
