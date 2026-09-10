import { useMemo, useState } from 'react'
import { RemoteTiltPad } from '@/modules/board/components/RemoteTiltPad'
import { Text } from '@/components/base/Text'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ToggleRow } from '@/components/dev/ShowcaseControls'
import type { RemoteTiltState } from 'vescape-core'

/** Synthetic native replies only. Never sends a command to a connected Board. */
export function RemoteTiltPadShowcase() {
  const [received, setReceived] = useState({ value: 128, count: 0 })
  const [slow, setSlow] = useState(true)
  const [connected, setConnected] = useState(true)
  const native = useMemo(() => {
    let state: RemoteTiltState | null = null
    let startedAt = 0
    let from = 128
    const read = () => {
      if (state?.phase !== 'decaying' || !state.decay) return state
      const elapsedMs = performance.now() - startedAt
      if (elapsedMs >= state.decay.totalMs) return (state = null)
      return {
        ...state,
        value: 128 + (from - 128) * (1 - elapsedMs / state.decay.totalMs),
        decay: { ...state.decay, elapsedMs },
      }
    }
    const delay = () => new Promise<void>((resolve) => setTimeout(resolve, slow ? 450 : 0))
    const release = (value: number, durationMs: number) => {
      from = value
      startedAt = performance.now()
      state =
        durationMs > 0
          ? { phase: 'decaying', value, decay: { elapsedMs: 0, totalMs: durationMs } }
          : null
    }
    return {
      async readState() {
        return read()
      },
      async onChange(value: number) {
        await delay()
        state = { phase: 'holding', value }
        setReceived((previous) => ({ value, count: previous.count + 1 }))
        return true
      },
      async onLock(value: number) {
        await delay()
        state = { phase: 'locked', value }
        return true
      },
      async onRelease(value: number, durationMs: number) {
        await delay()
        release(value, durationMs)
        return true
      },
      async onCancel() {
        await delay()
        release(read()?.value ?? 128, 600)
        return true
      },
    }
  }, [slow])

  return (
    <ShowcaseCard
      name="Remote Tilt"
      controls={
        <>
          <ToggleRow label="450ms command latency" value={slow} onToggle={setSlow} />
          <ToggleRow label="connected" value={connected} onToggle={setConnected} />
        </>
      }
    >
      <Text>
        Simulated native received: {received.value}, {received.count} drag commands
      </Text>
      <RemoteTiltPad key={String(slow)} {...native} connected={connected} disabled={!connected} />
    </ShowcaseCard>
  )
}
