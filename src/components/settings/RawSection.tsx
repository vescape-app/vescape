import { useMemo } from 'react'
import { Pressable, Share, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { ExportIcon } from 'phosphor-react-native'

import { theme } from '@/constants/theme'
import { tokenizeJson, type JsonTokenType } from '@/helpers/jsonHighlight'

const TOKEN_COLORS: Record<JsonTokenType, string> = {
  key: theme.palette.sky.light,
  string: theme.palette.green.light,
  number: theme.palette.amber.light,
  boolean: theme.palette.purple.thunder,
  null: theme.palette.red.light,
  punctuation: theme.neutral.textMuted,
  plain: theme.neutral.textSecondary,
}

interface RawSectionProps {
  title: string
  data: unknown
  exportName: string
  empty?: string
}

/** Key/value card that renders any record as syntax-highlighted, exportable JSON. */
export function RawSection({ title, data, exportName, empty }: RawSectionProps) {
  const entries =
    data && typeof data === 'object' ? Object.entries(data as Record<string, unknown>) : []

  const handleExport = () => {
    Share.share({ message: JSON.stringify(data, null, 2) }, { subject: `${exportName}.json` })
  }

  return (
    <>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {entries.length > 0 ? (
          <Pressable style={styles.exportButton} onPress={handleExport} hitSlop={8}>
            <ExportIcon size={14} color={theme.palette.sky.light} weight="bold" />
            <Text style={styles.exportText}>Export JSON</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.card}>
        {entries.length === 0 ? (
          <Text style={styles.emptyText}>{empty ?? 'No data'}</Text>
        ) : (
          entries.map(([key, value]) => {
            const isObject = value !== null && typeof value === 'object'
            return (
              <View key={key} style={isObject ? styles.kvColumn : styles.kvRow}>
                <Text style={styles.kvKey} selectable>
                  {key}
                </Text>
                <JsonValue value={value} block={isObject} />
              </View>
            )
          })
        )}
      </View>
    </>
  )
}

function JsonValue({ value, block }: { value: unknown; block?: boolean }) {
  const tokens = useMemo(() => tokenizeJson(value), [value])
  return (
    <Text style={block ? styles.jsonBlock : styles.kvValue} selectable>
      {tokens.map((token, i) => (
        <Text key={i} style={{ color: TOKEN_COLORS[token.type] }}>
          {token.text}
        </Text>
      ))}
    </Text>
  )
}

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    marginBottom: 4,
    marginLeft: 4,
  },
  sectionTitle: {
    color: theme.neutral.textMuted,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  exportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    backgroundColor: theme.neutral.surface,
  },
  exportText: {
    color: theme.palette.sky.light,
    fontSize: 12,
    fontWeight: '700',
  },
  card: {
    backgroundColor: theme.neutral.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    overflow: 'hidden',
  },
  kvRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.neutral.border,
  },
  kvColumn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.neutral.border,
  },
  jsonBlock: {
    fontSize: 12,
    fontFamily: 'monospace',
    lineHeight: 17,
  },
  kvKey: {
    flex: 1,
    color: theme.neutral.textMuted,
    fontSize: 12,
    fontFamily: 'monospace',
  },
  kvValue: {
    flex: 1,
    fontSize: 12,
    textAlign: 'right',
    fontFamily: 'monospace',
  },
  emptyText: {
    color: theme.neutral.textDim,
    fontSize: 13,
    padding: 14,
  },
})
