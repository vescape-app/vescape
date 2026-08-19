import { StyleSheet } from 'react-native'
import { Text } from '@/components/base/Text'
import { JoystickIcon } from 'phosphor-react-native'

import { RemoteTiltPad } from '@/modules/board/components/RemoteTiltPad'
import { CollapsibleWidget } from '@/components/widgets/CollapsibleWidget'
import { theme } from '@/constants/theme'
import { useRemoteTiltControl } from '@/modules/board/hooks/useRemoteTiltControl'

interface RemoteTiltControlProps {
  collapsible?: boolean
  defaultExpanded?: boolean
}

/** Remote tilt controller wrapper shared by IMU and center Tune drawer. */
export function RemoteTiltControl({
  collapsible = false,
  defaultExpanded = true,
}: RemoteTiltControlProps) {
  const {
    boardConnected,
    canCommand,
    setRemoteTilt,
    releaseRemoteTilt,
    lockRemoteTilt,
    stopRemoteTilt,
  } = useRemoteTiltControl()

  return (
    <CollapsibleWidget
      icon={JoystickIcon}
      title="Tilt"
      description="Adjust board tilt from your phone in real time."
      accent={theme.palette.sky.color}
      collapsible={collapsible}
      defaultExpanded={defaultExpanded}
      expandedHeight={330}
      surface={false}
    >
      <RemoteTiltBody
        boardConnected={boardConnected}
        canCommand={canCommand}
        setRemoteTilt={setRemoteTilt}
        releaseRemoteTilt={releaseRemoteTilt}
        lockRemoteTilt={lockRemoteTilt}
        stopRemoteTilt={stopRemoteTilt}
      />
    </CollapsibleWidget>
  )
}

function RemoteTiltBody({
  boardConnected,
  canCommand,
  setRemoteTilt,
  releaseRemoteTilt,
  lockRemoteTilt,
  stopRemoteTilt,
}: {
  boardConnected: boolean
  canCommand: boolean
  setRemoteTilt: (value: number) => void
  releaseRemoteTilt: (value: number, durationMs: number) => void
  lockRemoteTilt: (value: number) => void
  stopRemoteTilt: () => void
}) {
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
          {boardConnected ? 'Trusted board link required.' : 'Connect board to control tilt.'}
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
