import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { useAppActive } from '@/hooks/useAppActive'

/** Display-only work belongs to the focused screen while the app is active. */
export function useScreenVisible() {
  const appActive = useAppActive()
  const [focused, setFocused] = useState(false)
  useFocusEffect(
    useCallback(() => {
      setFocused(true)
      return () => setFocused(false)
    }, []),
  )
  return appActive && focused
}
