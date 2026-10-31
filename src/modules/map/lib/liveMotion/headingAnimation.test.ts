import { expect, test } from 'bun:test'
import { startHeadingAnimation } from './headingAnimation'

test('remount restores the drawn heading even when direction expired or the spring already settled', () => {
  const angle = { current: 90 }
  let bearing: number | null = 90
  let drawn = 90
  let time = 0
  let changed: (() => void) | null = null
  let scheduled: ((now: number) => void) | null = null
  const mount = () =>
    startHeadingAnimation({
      angle,
      heading: () => bearing,
      omega: () => 10,
      draw: (value) => {
        drawn = value
      },
      subscribe: (listener) => {
        changed = listener
        return () => {
          changed = null
        }
      },
      isActive: () => true,
      now: () => time,
      schedule: (callback) => {
        scheduled = callback
        return 1
      },
      cancel: () => {
        scheduled = null
      },
    })
  const emit = () => {
    changed?.()
  }
  let stop = mount()
  bearing = 180
  emit()
  for (let i = 0; i < 300 && scheduled; i++) {
    time += 16
    const frame = scheduled as ((now: number) => void) | null
    scheduled = null
    frame?.(time)
  }
  expect(drawn).toBeCloseTo(180, 1)
  stop()
  expect(changed).toBeNull()
  expect(scheduled).toBeNull()

  // Changing orientation destroys the native layer. Its JSX still starts at the first bearing.
  drawn = 90
  bearing = null
  stop = mount()
  expect(drawn).toBeCloseTo(180, 1)
  expect(scheduled).toBeNull()
  stop()

  // An exact settled angle takes the early-return path: no future frame can repair the layer.
  angle.current = 180
  drawn = 90
  bearing = 180
  stop = mount()
  expect(drawn).toBe(180)
  expect(scheduled).toBeNull()
  stop()
})
