import { isValidElement } from 'react'

const MAX_DEPTH = 16

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
