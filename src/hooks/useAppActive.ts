import { useEffect, useState } from 'react'
import { AppState } from 'react-native'

/**
 * True while the app is the foreground app. `inactive` counts as away: it is what a locking screen,
 * the app switcher, and an incoming call all report, and none of them are a rider watching.
 *
 * For work that only exists to be looked at. Anything that has to survive a locked phone belongs in
 * native, not behind this hook.
 */
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
