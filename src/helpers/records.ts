/**
 * Copy of `record` without `key`. Plain `delete` on a computed key deoptimises the object shape,
 * so build the survivor instead.
 */
export function omitKey<K extends string, V>(record: Record<K, V>, key: K): Record<K, V> {
  const next = {} as Record<K, V>
  for (const entry of Object.entries(record) as [K, V][]) {
    if (entry[0] !== key) next[entry[0]] = entry[1]
  }
  return next
}
