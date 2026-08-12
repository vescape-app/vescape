import { useCallback, useLayoutEffect, useRef } from 'react'

/**
 * Keeps one function identity while always invoking the latest callback.
 *
 * This is useful at native/runtime boundaries that retain a function reference
 * across React renders, such as Gesture Handler worklets scheduling work on JS.
 */
export function useLatestCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
): (...args: Args) => Result {
  const callbackRef = useRef(callback)

  useLayoutEffect(() => {
    callbackRef.current = callback
  }, [callback])

  return useCallback((...args: Args) => callbackRef.current(...args), [])
}
