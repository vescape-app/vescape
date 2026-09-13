import { StyleSheet } from 'react-native'
import { Text } from '@/components/base/Text'
import { JoystickIcon } from 'phosphor-react-native'

import { RemoteTiltPad } from '@/modules/board/components/RemoteTiltPad'
import { ExpandingWidget } from '@/components/widgets/ExpandingWidget'
import { theme } from '@/constants/theme'
import { useRemoteTiltControl } from '@/modules/board/hooks/useRemoteTiltControl'
import type { GroundClearanceRelease } from 'vescape-core'

/** Remote tilt controller row; the pad itself opens as a focused panel. */
export function RemoteTiltControl() {
  return (
    <ExpandingWidget
      icon={JoystickIcon}
      title="Tilt"
      description="Adjust board tilt from your phone in real time."
      accent={theme.palette.sky.color}
      body={RemoteTiltBody}
      surface={false}
    />
  )
}

/**
 * Why the ground-clearance binding is not commanding, in the rider's words.
 *
 * Native decides which of these it is and JS only names it; re-deriving any of these conditions here
 * would be a second definition of "safe to tilt" that could disagree with the one commanding the
 * board. Every reason gets a sentence — a read-only pad sitting at neutral with no explanation is
 * indistinguishable from a broken one.
 */
const RELEASE_REASONS: Record<GroundClearanceRelease, string> = {
  'not-riding': 'Waiting for you to ride. Sensor tilt is off while parked.',
  'no-link': 'Sensor accessory not connected.',
  'not-calibrated': 'Sensor not calibrated for this mounting position.',
  stale: 'No sensor readings. Tilt released.',
  'out-of-range': 'Sensor cannot see the ground. Tilt released.',
  'sensor-error': 'Sensor reported an error. Tilt released.',
  'board-untrusted': 'Board link is not trusted. Sensor tilt is blocked.',
  'board-stale': 'Board stopped reporting. Sensor tilt is blocked.',
  contested: 'Two calibrated sensors are configured. Sensor tilt is off until one is removed.',
  'board-move': 'Board Move is using the remote input.',
  'manual-tilt': 'Finishing your tilt before the sensor takes over.',
}

function RemoteTiltBody() {
  const {
    canCommand,
    boardConnected,
    sensorTilt,
    readState,
    blockedMessage,
    setRemoteTilt,
    releaseRemoteTilt,
    lockRemoteTilt,
    stopRemoteTilt,
  } = useRemoteTiltControl()

  const sensorNote = sensorTilt.driving
    ? 'Ground clearance sensor is controlling tilt.'
    : (sensorTilt.release && RELEASE_REASONS[sensorTilt.release]) ||
      'Ground clearance sensor is not commanding tilt.'

  return (
    <>
      <RemoteTiltPad
        // A bound pad is not dimmed: it is showing a live commanded tilt, which is exactly when it
        // needs to be readable.
        disabled={!canCommand && !sensorTilt.bound}
        readOnly={sensorTilt.bound}
        readOnlyLabel={sensorNote}
        connected={boardConnected}
        readState={readState}
        onChange={setRemoteTilt}
        onRelease={releaseRemoteTilt}
        onLock={lockRemoteTilt}
        onCancel={stopRemoteTilt}
      />
      {!canCommand && !sensorTilt.bound ? (
        <Text style={styles.remoteTiltDisabled}>
          {blockedMessage ?? 'Connect board to control tilt.'}
        </Text>
      ) : null}
    </>
  )
}

const styles = StyleSheet.create({
  remoteTiltDisabled: {
    color: theme.neutral.textDim,
    fontSize: 12,
  },
})
