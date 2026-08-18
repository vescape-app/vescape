import { Children, isValidElement, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { CaretDownIcon } from 'phosphor-react-native'

import { theme } from '@/constants/theme'

interface TuneGroupGridProps {
  title: string
  subtitle?: string
  collapsible?: boolean
  children: React.ReactNode
}

const COLUMNS = 2
const ROW_GAP = 8

interface TuneGroupGridChildProps {
  fullWidth?: boolean
}

function isFullWidthChild(child: React.ReactNode): boolean {
  return isValidElement<TuneGroupGridChildProps>(child) && child.props.fullWidth === true
}

function chunkCells(items: React.ReactNode[]): React.ReactNode[][] {
  const rows: React.ReactNode[][] = []
  let pendingRow: React.ReactNode[] = []

  for (const item of items) {
    if (isFullWidthChild(item)) {
      if (pendingRow.length > 0) {
        rows.push(pendingRow)
        pendingRow = []
      }
      rows.push([item])
      continue
    }

    pendingRow.push(item)
    if (pendingRow.length === COLUMNS) {
      rows.push(pendingRow)
      pendingRow = []
    }
  }

  if (pendingRow.length > 0) rows.push(pendingRow)

  return rows
}

function GridRows({ rows }: { rows: React.ReactNode[][] }) {
  return (
    <View style={styles.grid}>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.row}>
          {row.map((cell, cellIndex) => (
            <View key={cellIndex} style={styles.cellSlot}>
              {cell}
            </View>
          ))}
        </View>
      ))}
    </View>
  )
}

export function TuneGroupGrid({
  title,
  subtitle,
  collapsible = false,
  children,
}: TuneGroupGridProps) {
  const [collapsed, setCollapsed] = useState(true)
  const cells = Children.toArray(children)
  const rows = chunkCells(cells)

  const header = (
    <View style={styles.groupHeader}>
      <Text style={styles.groupTitle}>{title}</Text>
      {collapsible ? (
        <CaretDownIcon
          size={14}
          color={theme.neutral.textMuted}
          weight="bold"
          style={{ transform: [{ rotate: collapsed ? '0deg' : '180deg' }] }}
        />
      ) : subtitle ? (
        <Text style={styles.groupCount}>{subtitle}</Text>
      ) : null}
    </View>
  )

  if (collapsible) {
    return (
      <View style={styles.group}>
        <Pressable style={styles.groupHeaderPress} onPress={() => setCollapsed((value) => !value)}>
          {header}
        </Pressable>
        {!collapsed ? <GridRows rows={rows} /> : null}
      </View>
    )
  }

  return (
    <View style={styles.group}>
      {header}
      <GridRows rows={rows} />
    </View>
  )
}

const styles = StyleSheet.create({
  group: {
    gap: 8,
  },
  groupHeaderPress: {},
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  groupTitle: {
    color: theme.neutral.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  groupCount: {
    color: theme.neutral.textDim,
    fontSize: 11,
    fontWeight: '700',
  },
  grid: {
    gap: ROW_GAP,
  },
  row: {
    flexDirection: 'row',
    gap: ROW_GAP,
  },
  cellSlot: {
    flex: 1,
    minWidth: 0,
  },
})
