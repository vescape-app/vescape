import { useEffect, useState } from 'react'
import { AppState } from 'react-native'

export function useAppActive(): boolean {
  const [active, setActive] = useState(() => AppState.currentState === 'active')
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      setActive(next === 'active')
    })
    return () => subscription.remove()
  }, [])
  return active
}
