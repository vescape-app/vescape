import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { mySounds, type MySoundsState } from 'vescape-core'

const EMPTY: MySoundsState = { sounds: [], overrides: {} }

export function useMySounds() {
  const [state, setState] = useState<MySoundsState>(EMPTY)
  const [loadError, setLoadError] = useState(false)
  useFocusEffect(
    useCallback(() => {
      void mySounds()
        .then((next) => {
          setState(next)
          setLoadError(false)
        })
        .catch(() => setLoadError(true))
    }, []),
  )
  return { state, setState, loadError }
}
