import { useEffect } from 'react'

import {
  canRunFirmwareCommand,
  firmwareCommandBlockedMessage,
} from '@/modules/board/lib/boardLinkIntegrity'
import { useBleStore } from '@/modules/board/store/bleStore'
import {
  lockRemoteTilt as lockRemoteTiltNative,
  releaseRemoteTilt,
  setRemoteTilt,
  stopRemoteTilt,
} from 'vescape-core'

export function useRemoteTiltControl() {
  const boardConnected = useBleStore((state) => state.status === 'connected')
  const linkIntegrity = useBleStore((state) => state.linkIntegrity)
  const canCommand = boardConnected && canRunFirmwareCommand(linkIntegrity)
  const syncRemoteTilt = useBleStore((state) => state.syncRemoteTilt)

  useEffect(() => {
    syncRemoteTilt()
  }, [syncRemoteTilt])

  return {
    boardConnected,
    canCommand,
    blockedMessage:
      boardConnected && !canCommand ? firmwareCommandBlockedMessage(linkIntegrity) : null,
    setRemoteTilt: (value: number) => {
      if (canCommand) void setRemoteTilt(value)
    },
    releaseRemoteTilt: (value: number, durationMs: number) =>
      canCommand ? void releaseRemoteTilt(value, durationMs) : undefined,
    lockRemoteTilt: (value: number) => {
      if (canCommand) void lockRemoteTiltNative(value)
    },
    stopRemoteTilt: () => {
      if (canCommand) void stopRemoteTilt()
    },
  }
}
