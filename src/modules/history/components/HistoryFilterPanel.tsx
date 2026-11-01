import { useState } from 'react'
import type { RideHistoryFilter, RideWeatherCondition } from 'vescape-core'
import { StyleSheet, View } from 'react-native'

import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import { DateField } from '@/components/forms/DateField'
import { theme } from '@/constants/theme'
import { useAsyncRead } from '@/hooks/useAsyncRead'
import { WeatherFilterGrid } from '@/modules/history/components/WeatherFilterGrid'
import { useBoardStore } from '@/modules/board/store/boardStore'
import {
  EMPTY_RIDE_FILTER,
  customRange,
  presetRange,
  toRideHistoryFilter,
  type RideDatePreset,
  type RideFilterSelection,
} from '@/modules/history/lib/rideFilter'

const DATE_PRESETS: readonly { preset: RideDatePreset; label: string }[] = [
  { preset: 'thisMonth', label: 'This month' },
  { preset: 'previousMonth', label: 'Previous month' },
  { preset: 'custom', label: 'Custom range' },
]

const DAY_MS = 24 * 60 * 60_000

interface HistoryFilterPanelProps {
  selection: RideFilterSelection
  /** Matches for the draft, so the rider sees the result size before applying it. */
  countMatches: (filter: RideHistoryFilter) => Promise<number>
  /** Plural noun for what is counted, e.g. `rides` or `favorites`. */
  noun: { one: string; other: string }
  onApply: (selection: RideFilterSelection) => void
}

/** Date and Board filter for both History tabs; edits a draft until Apply. */
export function HistoryFilterPanel({
  selection,
  countMatches,
  noun,
  onApply,
}: HistoryFilterPanelProps) {
  const boards = useBoardStore((state) => state.boards)
  const [draft, setDraft] = useState(selection)
  const draftFilter = toRideHistoryFilter(draft)
  const matches = useAsyncRead(
    () => countMatches(draftFilter),
    null as number | null,
    JSON.stringify(draftFilter),
  )
  const applyLabel =
    matches.loading || matches.value == null
      ? 'Apply'
      : matches.value === 0
        ? `No matching ${noun.other}`
        : `Show ${matches.value} ${matches.value === 1 ? noun.one : noun.other}`
  const today = new Date()

  const pickPreset = (preset: RideDatePreset) => {
    if (draft.date?.preset === preset) {
      setDraft({ ...draft, date: null })
      return
    }
    const now = Date.now()
    const date =
      preset === 'custom'
        ? customRange(draft.date?.fromMs ?? now - 6 * DAY_MS, (draft.date?.toMs ?? now + 1) - 1)
        : presetRange(preset, now)
    setDraft({ ...draft, date })
  }

  const toggleBoard = (boardId: string) => {
    const boardIds = draft.boardIds.includes(boardId)
      ? draft.boardIds.filter((id) => id !== boardId)
      : [...draft.boardIds, boardId]
    setDraft({ ...draft, boardIds })
  }

  const toggleWeather = (condition: RideWeatherCondition) => {
    const weather = draft.weather.includes(condition)
      ? draft.weather.filter((item) => item !== condition)
      : [...draft.weather, condition]
    setDraft({ ...draft, weather })
  }

  const custom = draft.date?.preset === 'custom' ? draft.date : null
  const customFrom = custom ? new Date(custom.fromMs) : today
  const customTo = custom ? new Date(custom.toMs - 1) : today

  return (
    <View style={styles.content} testID="history-filter-panel">
      <Text style={styles.heading}>Date</Text>
      <View style={styles.chips}>
        {DATE_PRESETS.map(({ preset, label }) => (
          <Button
            key={preset}
            label={label}
            size="sm"
            variant={draft.date?.preset === preset ? 'accent' : 'secondary'}
            testID={`history-filter-date-${preset}`}
            onPress={() => pickPreset(preset)}
          />
        ))}
      </View>
      {custom ? (
        <View style={styles.range}>
          <DateField
            label="From"
            value={customFrom}
            maximumDate={today}
            testID="history-filter-from"
            onChange={(date) =>
              setDraft({ ...draft, date: customRange(date.getTime(), customTo.getTime()) })
            }
          />
          <DateField
            label="To"
            value={customTo}
            minimumDate={customFrom}
            maximumDate={today}
            testID="history-filter-to"
            onChange={(date) =>
              setDraft({ ...draft, date: customRange(customFrom.getTime(), date.getTime()) })
            }
          />
        </View>
      ) : null}

      <Text style={styles.heading}>Weather</Text>
      <WeatherFilterGrid value={draft.weather} onToggle={toggleWeather} />

      {boards.length > 1 ? (
        <>
          <Text style={styles.heading}>Board</Text>
          <View style={styles.chips}>
            {boards.map((board) => (
              <Button
                key={board.id}
                label={board.name}
                size="sm"
                variant={draft.boardIds.includes(board.id) ? 'accent' : 'secondary'}
                testID={`history-filter-board-${board.id}`}
                onPress={() => toggleBoard(board.id)}
              />
            ))}
          </View>
        </>
      ) : null}

      <View style={styles.actions}>
        <Button
          label="Clear"
          variant="secondary"
          style={styles.action}
          testID="history-filter-clear"
          onPress={() => onApply(EMPTY_RIDE_FILTER)}
        />
        <Button
          label={applyLabel}
          variant="accent"
          disabled={matches.value === 0}
          style={styles.action}
          testID="history-filter-apply"
          onPress={() => onApply(draft)}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  content: {
    gap: 12,
    paddingVertical: 8,
  },
  heading: {
    color: theme.neutral.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  range: {
    gap: 8,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 8,
  },
  action: {
    flex: 1,
  },
})
