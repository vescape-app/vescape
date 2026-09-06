'worklet'

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function clampFinite(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? clamp(value, min, max) : fallback
}

export function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0
}

export function moveTowards(current: number, target: number, maxDelta: number): number {
  if (maxDelta <= 0 || current === target) return current
  const delta = target - current
  if (Math.abs(delta) <= maxDelta) return target
  return current + Math.sign(delta) * maxDelta
}
