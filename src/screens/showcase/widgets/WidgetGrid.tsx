import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'

/** A horizontal grid row — each `Cell` child takes an equal fraction of the width. */
export function Row({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>
}

export function Cell({ children }: { children?: ReactNode }) {
  return <View style={styles.cell}>{children}</View>
}

export function SizeLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.sizeLabel}>{children}</Text>
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  cell: { flex: 1 },
  sizeLabel: {
    color: theme.palette.slate.textMuted,
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
    marginTop: 4,
  },
})
