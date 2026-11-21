import { useEffect, useState } from 'react'

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
