import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { mySounds, type MySoundsState } from 'vescape-core'

const EMPTY: MySoundsState = { sounds: [], overrides: {} }

/** The native My sounds library, reloaded whenever the screen regains focus. */
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
