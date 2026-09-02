import { StyleSheet } from 'react-native'
import { Text } from '@/components/base/Text'
import { JoystickIcon } from 'phosphor-react-native'

import { RemoteTiltPad } from '@/modules/board/components/RemoteTiltPad'
import { ExpandingWidget } from '@/components/widgets/ExpandingWidget'
import { theme } from '@/constants/theme'
import { useRemoteTiltControl } from '@/modules/board/hooks/useRemoteTiltControl'

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

function RemoteTiltBody() {
  const {
    canCommand,
    blockedMessage,
    setRemoteTilt,
    releaseRemoteTilt,
    lockRemoteTilt,
    stopRemoteTilt,
  } = useRemoteTiltControl()

  return (
    <>
      <RemoteTiltPad
        disabled={!canCommand}
        onChange={setRemoteTilt}
        onRelease={releaseRemoteTilt}
        onLock={lockRemoteTilt}
        onCancel={stopRemoteTilt}
      />
      {!canCommand ? (
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
