import { StyleSheet, View } from 'react-native'
import { SlidersHorizontalIcon } from 'phosphor-react-native'

import { Placeholder } from '@/components/base/Placeholder'
import { SectionHeader } from '@/components/base/SectionHeader'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { useUserPreferences } from '@/hooks/useUserPreferences'
import {
  useBoardConfigFields,
  useBoardConfigValuesStore,
} from '@/modules/board/store/boardConfigValuesStore'
import type { ConfigRow } from '@/modules/board/lib/boardConfigReadout'

export interface BoardConfigSectionValues {
  freshness: 'fresh' | 'last-known'
  values: Record<string, number | boolean | undefined>
}

export function BoardConfigSection({
  title = 'Board config',
  rows,
  values: override,
  empty = 'No config read from this board yet. Connect it to read its setup.',
  error,
  boardId,
  showFreshness = true,
  showDescriptions = false,
}: {
  boardId?: string
  showFreshness?: boolean
  showDescriptions?: boolean
  title?: string
  rows: ConfigRow<string>[]
  values?: BoardConfigSectionValues | null
  empty?: string
  error?: string | null
}) {
  const refloat = useBoardConfigFields(boardId)
  const refloatError = useBoardConfigValuesStore((state) => state.error)
  const { temperatureUnit } = useUserPreferences()
  const values = override === undefined ? refloat : override
  const resolvedError = error ?? (override === undefined ? refloatError : null)

  return (
    <View style={styles.section}>
      <SectionHeader
        icon={SlidersHorizontalIcon}
        color={theme.palette.sky.color}
        title={title}
        right={
          showFreshness && values?.freshness === 'last-known' ? (
            <Text style={styles.stale}>Last known</Text>
          ) : null
        }
      />
      <View style={styles.card}>
        {values == null ? (
          <Placeholder
            icon={SlidersHorizontalIcon}
            description={resolvedError ?? empty}
            style={styles.empty}
          />
        ) : (
          rows.map((row) => {
            const value = values.values[row.id]
            const description = showDescriptions ? row.description : undefined
            const note = description ?? row.note?.(value)
            return (
              <View key={row.id} style={styles.row}>
                <View style={styles.rowTop}>
                  <Text style={[styles.label, showDescriptions && styles.describedLabel]}>
                    {row.label}
                  </Text>
                  <Text style={styles.value}>{row.format(value, { temperatureUnit })}</Text>
                </View>
                {note ? (
                  <Text style={description ? styles.description : styles.note}>
                    {note}
                    {showDescriptions && row.recommended ? (
                      <Text style={styles.whenLabel}>{` (recommended ${row.recommended})`}</Text>
                    ) : null}
                  </Text>
                ) : null}
                {showDescriptions && row.when ? (
                  <Text style={styles.whenText}>
                    <Text style={styles.whenLabel}>When: </Text>
                    {row.when}
                  </Text>
                ) : null}
              </View>
            )
          })
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  section: {
    gap: 10,
  },
  card: {
    gap: 2,
  },
  row: {
    paddingVertical: 7,
    gap: 2,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  label: {
    flex: 1,
    color: theme.neutral.textSecondary,
    fontSize: 14,
  },
  value: {
    color: theme.neutral.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  describedLabel: {
    color: theme.neutral.textPrimary,
    fontWeight: '600',
  },
  whenText: {
    marginTop: 6,
    color: theme.neutral.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  whenLabel: {
    color: theme.neutral.textSecondary,
    fontSize: 12,
  },
  description: {
    color: theme.neutral.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  note: {
    color: theme.neutral.textDim,
    fontSize: 12,
  },
  stale: {
    color: theme.neutral.textDim,
    fontSize: 12,
  },
  empty: {
    flex: 0,
    paddingVertical: 24,
  },
})
