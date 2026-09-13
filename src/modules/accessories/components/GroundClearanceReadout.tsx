import { StyleSheet, View } from 'react-native'
import type { AccessoryReadingStatus } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { readingCopy } from '@/modules/accessories/lib/groundClearanceCopy'
import { theme } from '@/constants/theme'

interface GroundClearanceReadoutProps {
  /** Null while native has accepted no sample yet in this protocol session. */
  status: AccessoryReadingStatus | null
  /** Set only when `status` is `ok`. Never borrowed from an earlier sample. */
  valueCm: number | null
  /** Whether native currently has the sensor measuring at all. */
  measuring: boolean
}

/**
 * The live distance, or an honest account of why there is not one.
 *
 * Four states, and only one of them is a number. A sensor that cannot see the ground, one that
 * failed outright, and one that is not running at all read as three different sentences — because
 * they are three different problems, and a single blank would leave the rider guessing which.
 *
 * There is deliberately no "last known" fallback. Holding the previous value on the screen while
 * the sensor is silent is exactly the illusion this feature exists to avoid: the rider would read a
 * clearance the board no longer has.
 */
export function GroundClearanceReadout({
  status,
  valueCm,
  measuring,
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
        <Text style={[styles.value, { color: theme.neutral.textDim }]}>—</Text>
        <Text style={styles.detail}>Waiting for the first measurement…</Text>
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
