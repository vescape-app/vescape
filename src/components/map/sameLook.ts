import { isValidElement } from 'react'

/** Deeper than any marker's content; past it, values count as changed. */
const MAX_DEPTH = 16

/**
 * Whether two renders of an in-map marker's content draw the same, as far as their element trees
 * tell: same element types, keys and props, compared by value. Functions compare equal: press
 * handlers and `Pressable`'s style function are recreated on every render without changing what
 * is drawn. State inside the content's own components is invisible here; those changes refresh
 * through `useInMapMarkerRefresh` and touches.
 */
export function sameLook(a: unknown, b: unknown, depth = 0): boolean {
  if (Object.is(a, b)) return true
  if (typeof a === 'function' && typeof b === 'function') return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (depth > MAX_DEPTH) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, index) => sameLook(item, b[index], depth + 1))
  }
  if (isValidElement(a) || isValidElement(b)) {
    if (!isValidElement(a) || !isValidElement(b)) return false
    return a.type === b.type && a.key === b.key && sameLook(a.props, b.props, depth + 1)
  }
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  return keys.every(
    (key) => Object.hasOwn(right, key) && sameLook(left[key], right[key], depth + 1),
  )
}
