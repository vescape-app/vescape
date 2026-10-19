/** Ignore repeated navigation from a screen that has already advanced. */
export function moveWizardSubstep(current: number, rendered: number, delta: number, count: number) {
  if (current !== rendered) return current
  return Math.max(0, Math.min(count - 1, current + delta))
}
