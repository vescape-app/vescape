import { StyleSheet, View } from 'react-native'
import type { AccessoryReadingStatus } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { readingCopy } from '@/modules/accessories/lib/groundClearanceCopy'
import { theme } from '@/constants/theme'

interface GroundClearanceReadoutProps {
  status: AccessoryReadingStatus | null
  valueCm: number | null
  measuring: boolean
  stalled?: boolean
}

export function GroundClearanceReadout({
  status,
  valueCm,
  measuring,
  stalled = false,
}: GroundClearanceReadoutProps) {
  if (!measuring) {
    return (
      <View style={styles.frame}>
        <Text style={[styles.value, { color: theme.neutral.textDim }]}>—</Text>
        <Text style={styles.detail}>
          Not measuring. The sensor runs while this screen is open, and while you are riding a board
          this accessory is calibrated for.
        </Text>
      </View>
    )
  }

  if (status == null) {
    return (
      <View style={styles.frame}>
        <Text
          style={[
            styles.value,
            { color: stalled ? theme.status.caution.text : theme.neutral.textDim },
          ]}
        >
          —
        </Text>
        <Text style={styles.detail}>
          {stalled
            ? 'The sensor stopped sending measurements. It may have lost power or moved out of range.'
            : 'Waiting for the first measurement…'}
        </Text>
      </View>
    )
  }

  const copy = readingCopy(status, valueCm)
  const tint = copy.tone === 'success' ? theme.palette.sky.color : theme.status.caution.text

  return (
    <View style={styles.frame}>
      <Text style={[styles.value, { color: tint }]} testID="ground-clearance-value">
        {copy.value}
      </Text>
      {copy.detail ? <Text style={styles.detail}>{copy.detail}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  frame: {
    alignItems: 'center',
    gap: 6,
    paddingVertical: 22,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    backgroundColor: theme.neutral.surface,
  },
  value: {
    fontFamily: theme.mono('700'),
    fontSize: 40,
    lineHeight: 46,
  },
  detail: {
    color: theme.neutral.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
})
