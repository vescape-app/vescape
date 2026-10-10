import { useCallback, useEffect, useState } from 'react'

import {
  canRunFirmwareCommand,
  firmwareCommandBlockedMessage,
} from '@/modules/board/lib/boardLinkIntegrity'
import { useBleStore } from '@/modules/board/store/bleStore'
import {
  getGroundClearanceTilt,
  getRemoteTiltState,
  lockRemoteTilt,
  releaseRemoteTilt,
  setRemoteTilt,
  stopRemoteTilt,
  type GroundClearanceTiltState,
} from 'vescape-core'

/** No Accessory bound, nothing driving. What an unbound Board looks like. */
const UNBOUND: GroundClearanceTiltState = { bound: false, driving: false, release: null }

/**
 * How often the binding's verdict is re-read.
 *
 * Slower than the pad's own 100ms tilt poll on purpose: this answers "whose pad is this", which
 * changes when an Accessory connects or the rider finishes a calibration, not every frame.
 */
const SENSOR_POLL_MS = 250

export function useRemoteTiltControl() {
  const boardConnected = useBleStore((state) => state.status === 'connected')
  const linkIntegrity = useBleStore((state) => state.linkIntegrity)
  const [sensorTilt, setSensorTilt] = useState<GroundClearanceTiltState>(UNBOUND)

  // Native arbitrates and refuses manual commands on its own; this only decides what the pad looks
  // like. A failed read therefore keeps the last verdict rather than falling back to "yours" — the
  // safe direction for a rider is a pad that stays read-only, not one that quietly comes back.
  useEffect(() => {
    if (!boardConnected) {
      setSensorTilt(UNBOUND)
      return
    }
    let disposed = false
    const read = async () => {
      try {
        const next = await getGroundClearanceTilt()
        if (disposed) return
        setSensorTilt((previous) =>
          previous.bound === next.bound &&
          previous.driving === next.driving &&
          previous.release === next.release
            ? previous
            : next,
        )
      } catch {
        // Native still refuses what it refuses; only the caption is stale.
      }
    }
    void read()
    const timer = setInterval(() => {
      void read()
    }, SENSOR_POLL_MS)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [boardConnected])

  const canCommand = boardConnected && canRunFirmwareCommand(linkIntegrity) && !sensorTilt.bound
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
    /** What the ground-clearance binding is doing; `bound` makes the pad a read-only indicator. */
    sensorTilt,
    blockedMessage:
      boardConnected && !canCommand && !sensorTilt.bound
        ? firmwareCommandBlockedMessage(linkIntegrity)
        : null,
    readState: getRemoteTiltState,
    setRemoteTilt: hold,
    releaseRemoteTilt: release,
    lockRemoteTilt: lock,
    stopRemoteTilt,
  }
}
