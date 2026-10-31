import { useEffect, useEffectEvent, useState } from 'react'

type Settled<T> = { key: string; value: T; error: false } | { key: string; error: true }

/**
 * The result of `read` for the current `key`, re-read whenever the key changes. Until it settles,
 * `loading` is true and `value` is `initial`; a result for an older key is dropped.
 */
export function useAsyncRead<T>(read: () => Promise<T>, initial: T, key: string) {
  const [settled, setSettled] = useState<Settled<T> | null>(null)
  const runRead = useEffectEvent(read)

  useEffect(() => {
    let cancelled = false
    runRead()
      .then((value) => {
        if (!cancelled) setSettled({ key, value, error: false })
      })
      .catch((err: unknown) => {
        console.warn('[useAsyncRead] read failed', key, err)
        if (!cancelled) setSettled({ key, error: true })
      })
    return () => {
      cancelled = true
    }
  }, [key])

  const current = settled?.key === key ? settled : null
  return {
    value: current && !current.error ? current.value : initial,
    loading: current == null,
    error: current?.error ?? false,
  }
}
