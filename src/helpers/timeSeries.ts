export function pruneByTime<T>(
  items: T[],
  nowMs: number,
  windowMs: number,
  key: (item: T) => number,
): void {
  const oldest = nowMs - windowMs
  let firstKept = 0
  while (firstKept < items.length && key(items[firstKept]) < oldest) firstKept += 1
  if (firstKept > 0) items.splice(0, firstKept)
}

export function insertByTime<T>(items: T[], item: T, key: (item: T) => number): void {
  const itemKey = key(item)

  // Fast path: samples almost always arrive in chronological order, so a strictly
  // newer key just appends — no O(N) dedup/insert scan.
  const lastKey = items.length > 0 ? key(items[items.length - 1]) : -Infinity
  if (itemKey > lastKey) {
    items.push(item)
    return
  }

  // Out-of-order (or duplicate) sample: fall back to the ordered insert.
  if (items.some((existing) => key(existing) === itemKey)) return
  const insertAt = items.findIndex((existing) => key(existing) > itemKey)
  if (insertAt === -1) items.push(item)
  else items.splice(insertAt, 0, item)
}
