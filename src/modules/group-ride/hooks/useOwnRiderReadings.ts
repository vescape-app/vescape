import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { useShallow } from 'zustand/react/shallow'
import { addLiveTickListener } from 'vescape-core'

import { absolute, finite } from '@/helpers/finite'
import { useBleStore } from '@/modules/board/store/bleStore'
import { useBoardStore } from '@/modules/board/store/boardStore'
import type { RiderReadings } from '@/modules/group-ride/lib/riderStats'

export function useOwnRiderReadings(active = true): RiderReadings {
  const { connectedId, connectionSeq, status } = useBleStore(
    useShallow((state) => ({
      connectedId: state.connectedId,
      connectionSeq: state.connectionSeq,
      status: state.status,
    })),
  )
  const boardName = useBoardStore((s) => s.boards.find((board) => board.id === connectedId)?.name)
  const [sample, setSample] = useState<{ generation: number; readings: RiderReadings }>()

  useFocusEffect(
    useCallback(() => {
      if (!active || status !== 'connected') return
      let lastUpdate = -Infinity
      const subscription = addLiveTickListener((tick) => {
        if (tick.generation != null && tick.generation !== connectionSeq) return
        const now = performance.now()
        if (now - lastUpdate < 1_000) return
        lastUpdate = now
        const speedKmh = absolute(tick.speed)
        const batteryPercent = finite(tick.batteryPercent)
        setSample({
          generation: connectionSeq,
          readings: {
            speed: speedKmh == null ? null : speedKmh / 3.6,
            soc: batteryPercent == null ? null : batteryPercent / 100,
            motorTemp: tick.tempMotor != null && tick.tempMotor > 0 ? tick.tempMotor : null,
            ctrlTemp: finite(tick.tempMosfet),
          },
        })
      })
      return () => subscription.remove()
    }, [active, connectionSeq, status]),
  )

  if (!active || status !== 'connected') return {}
  const readings = sample?.generation === connectionSeq ? sample.readings : undefined
  return { ...readings, boardName: boardName ?? 'Board connected' }
}
