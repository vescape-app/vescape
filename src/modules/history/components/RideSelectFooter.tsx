import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { ExportIcon, TrashIcon } from 'phosphor-react-native'
import type { RideExportFormat, RideExportProgressEvent } from 'vescape-core'

import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import { PillChoiceRow } from '@/components/forms/PillChoiceRow'
import { theme } from '@/constants/theme'

const FORMATS = [
  { value: 'gpx', label: 'GPX' },
  { value: 'csv', label: 'CSV' },
  { value: 'floaty', label: 'Floaty' },
] as const satisfies readonly { value: RideExportFormat; label: string }[]

interface RideSelectFooterProps {
  count: number
  noun: { one: string; other: string }
  format: RideExportFormat
  onFormat: (format: RideExportFormat) => void
  /** Export progress while native writes the zip; null when idle. */
  progress: RideExportProgressEvent | null
  error: string | null
  onExport: () => void
  onCancelExport: () => void
  onDelete: () => Promise<void>
}

/** Select mode's pinned action bar: export format, Delete with an inline confirm, Export. */
export function RideSelectFooter({
  count,
  noun,
  format,
  onFormat,
  progress,
  error,
  onExport,
  onCancelExport,
  onDelete,
}: RideSelectFooterProps) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const label = `${count} ${count === 1 ? noun.one : noun.other}`

  if (progress) {
    return (
      <View style={styles.row} testID="ride-select-export-progress">
        <Text style={styles.message}>
          {`Exporting ${progress.done} of ${progress.total || count}`}
        </Text>
        <Button label="Cancel" variant="secondary" onPress={onCancelExport} />
      </View>
    )
  }

  if (confirming) {
    return (
      <View style={styles.row}>
        <Text style={styles.message}>{`Delete ${label}?`}</Text>
        <Button
          label="Cancel"
          variant="secondary"
          disabled={deleting}
          onPress={() => setConfirming(false)}
        />
        <Button
          label="Delete"
          variant="destructive"
          loading={deleting}
          testID="ride-select-delete-confirm"
          onPress={async () => {
            setDeleting(true)
            try {
              await onDelete()
            } finally {
              setDeleting(false)
              setConfirming(false)
            }
          }}
        />
      </View>
    )
  }

  return (
    <View style={styles.footer}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <PillChoiceRow options={FORMATS} value={format} onChange={onFormat} />
      <View style={styles.row}>
        <Button
          label="Delete"
          icon={TrashIcon}
          variant="destructive"
          disabled={count === 0}
          testID="ride-select-delete"
          onPress={() => setConfirming(true)}
        />
        <Button
          style={styles.grow}
          label={count === 0 ? 'Export' : `Export ${label}`}
          icon={ExportIcon}
          variant="accent"
          disabled={count === 0}
          testID="ride-select-export"
          onPress={onExport}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  footer: { gap: 10, paddingTop: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grow: { flex: 1 },
  message: {
    flex: 1,
    color: theme.neutral.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  error: { color: theme.palette.red.color, fontSize: 13 },
})
