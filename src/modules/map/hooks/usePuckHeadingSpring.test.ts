import { expect, test } from 'bun:test'

// Exercise the actual hook with deterministic frames, isolated from other React/native mocks.
test('puck rotation stays continuous across north, responds four times as fast, and stops in background', () => {
  const result = Bun.spawnSync({
    cmd: [
      process.execPath,
      '--preload',
      './testSetup.ts',
      '--eval',
      `
      import { mock } from 'bun:test'
      import { strict as assert } from 'node:assert'
      const slots = []; let cursor = 0; let pending = []; let active = true; let now = 0
      const same = (a, b) => a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]))
      mock.module('react', () => ({
        default: {},
        useRef: value => { const i = cursor++; return slots[i] ??= { current: value } },
        useCallback: (fn, deps) => {
          const i = cursor++
          if (!same(slots[i]?.deps, deps)) slots[i] = { fn, deps }
          return slots[i].fn
        },
        useEffect: (fn, deps) => {
          const i = cursor++
          if (!same(slots[i]?.deps, deps)) pending.push(() => {
            slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }
          })
        },
      }))
      mock.module('@/hooks/useAppActive', () => ({ useAppActive: () => active }))
      const frames = new Map(); let next = 0
      globalThis.requestAnimationFrame = fn => { frames.set(++next, fn); return next }
      globalThis.cancelAnimationFrame = id => frames.delete(id)
      Object.defineProperty(performance, 'now', { value: () => now })
      const { usePuckHeadingSpring } = await import('./src/modules/map/hooks/usePuckHeadingSpring.ts')
      const { createSpring, retargetSpring, stepSpring } = await import('./src/modules/map/lib/cameraEngine/springs.ts')
      const { GPS_HEADING_CAMERA_OMEGA } = await import('./src/modules/map/constants/gpsHeadingMotion.ts')
      let angle; const writes = []
      const layer = { setNativeProps: ({ style }) => { angle = style.iconRotate; writes.push(angle) } }
      const render = heading => {
        cursor = 0; const hook = usePuckHeadingSpring(heading)
        hook.layerRef.current = layer
        const effects = pending; pending = []; effects.forEach(fn => fn())
      }
      const tick = time => {
        now = time; const callbacks = [...frames.values()]; frames.clear()
        callbacks.forEach(fn => fn(now))
      }
      render(359); tick(0); assert.equal(angle, 359)
      render(1); const before = angle
      for (let i = 1; i <= 30; i++) {
        tick(i * 1000 / 60)
        if (i === 10) { const prior = angle; render(1); assert.equal(angle, prior) }
      }
      const expected = stepSpring(retargetSpring(createSpring(359), 361), GPS_HEADING_CAMERA_OMEGA, 2)
      assert.ok(Math.abs(angle - (expected.x % 360)) < 1e-8, 'half a second matches two seconds of camera rotation')
      const travelled = (angle - before + 360) % 360
      assert.ok(travelled > 0 && travelled < 2, 'cross north along two degrees, never spin backwards')
      const prior = angle; render(40); assert.equal(angle, prior, 'retarget cannot snap')
      const { useHeadingMotionStore } = await import('./src/modules/map/store/headingMotionStore.ts')
      useHeadingMotionStore.getState().setSpeed('arrowSpeedPercent', 200)
      assert.equal(angle, prior, 'changing speed cannot snap position')
      const initialArrow = stepSpring(retargetSpring(createSpring(359), 361), GPS_HEADING_CAMERA_OMEGA * 4, 0.5)
      const faster = stepSpring(retargetSpring(initialArrow, 400), GPS_HEADING_CAMERA_OMEGA * 8, 0.016)
      tick(now + 16)
      assert.ok(Math.abs(angle - (faster.x % 360)) < 1e-8, 'live speed change preserves angular velocity and doubles omega')
      active = false; render(40); assert.equal(frames.size, 0)
      for (const slot of slots) slot?.cleanup?.()
      assert.equal(frames.size, 0)
    `,
    ],
    cwd: process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  expect({ exitCode: result.exitCode, stderr: new TextDecoder().decode(result.stderr) }).toEqual({
    exitCode: 0,
    stderr: '',
  })
})
