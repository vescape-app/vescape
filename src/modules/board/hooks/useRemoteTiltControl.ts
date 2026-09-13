import { useCallback } from 'react'

import {
  canRunFirmwareCommand,
  firmwareCommandBlockedMessage,
} from '@/modules/board/lib/boardLinkIntegrity'
import { useBleStore } from '@/modules/board/store/bleStore'
import {
  getRemoteTiltState,
  lockRemoteTilt,
  releaseRemoteTilt,
  setRemoteTilt,
  stopRemoteTilt,
} from 'vescape-core'

export function useRemoteTiltControl() {
  const boardConnected = useBleStore((state) => state.status === 'connected')
  const linkIntegrity = useBleStore((state) => state.linkIntegrity)
  const canCommand = boardConnected && canRunFirmwareCommand(linkIntegrity)
  const hold = useCallback(
    (value: number) => (canCommand ? setRemoteTilt(value) : Promise.resolve(false)),
    [canCommand],
  )
  const release = useCallback(
    (value: number, durationMs: number) =>
      canCommand ? releaseRemoteTilt(value, durationMs) : stopRemoteTilt(),
    [canCommand],
  )
  const lock = useCallback(
    (value: number) => (canCommand ? lockRemoteTilt(value) : Promise.resolve(false)),
    [canCommand],
  )

  return {
    boardConnected,
    canCommand,
    blockedMessage:
      boardConnected && !canCommand ? firmwareCommandBlockedMessage(linkIntegrity) : null,
    readState: getRemoteTiltState,
    setRemoteTilt: hold,
    releaseRemoteTilt: release,
    lockRemoteTilt: lock,
    stopRemoteTilt,
  }
}
