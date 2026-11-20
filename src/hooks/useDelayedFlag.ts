import { useEffect, useState } from 'react'

/** `value`, but a turn to `true` only shows after it has held for `delayMs`; `false` is immediate. */
export function useDelayedFlag(value: boolean, delayMs: number): boolean {
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (!value) return
    const timer = setTimeout(() => setShown(true), delayMs)
    return () => {
      clearTimeout(timer)
      setShown(false)
    }
  }, [value, delayMs])

  return value && shown
}
