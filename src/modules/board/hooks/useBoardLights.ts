import { useEffect, useRef, useState } from 'react'
import { addBoardLightsListener, setBoardLights } from 'vescape-core'
import { createBoardLightsWriteQueue } from './boardLightsWriteQueue'

interface BoardLightsState {
  enabled: boolean | null
  headlightsEnabled: boolean | null
}

export function useBoardLights() {
  const [state, setState] = useState<BoardLightsState>({ enabled: null, headlightsEnabled: null })
  const [error, setError] = useState<string | null>(null)
  const writerRef = useRef<ReturnType<typeof createBoardLightsWriteQueue> | null>(null)
  if (writerRef.current == null)
    writerRef.current = createBoardLightsWriteQueue(setBoardLights, setError)

  useEffect(() => {
    const subscription = addBoardLightsListener((event) => {
      const next = { enabled: event.enabled, headlightsEnabled: event.headlightsEnabled }
      writerRef.current?.setReportedState(next)
      setState(next)
    })
    return () => {
      writerRef.current?.dispose()
      subscription.remove()
    }
  }, [])

  return {
    enabled: state.enabled,
    headlightsEnabled: state.headlightsEnabled,
    error,
    setLights: (enabled: boolean) => writerRef.current?.write({ enabled }),
    setHeadlights: (headlightsEnabled: boolean) => writerRef.current?.write({ headlightsEnabled }),
  }
}
