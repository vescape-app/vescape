import { describe, expect, test } from 'bun:test'

import { createCameraEngine, type EngineCamera } from './engine'
import {
  createSpring,
  nearestBearingTarget,
  retargetSpring,
  shortestArcDelta,
  springSettled,
  stepSpring,
} from './springs'

const settle = (spring: ReturnType<typeof createSpring>, omega: number, seconds: number) => {
  let s = spring
  for (let t = 0; t < seconds; t += 1 / 60) s = stepSpring(s, omega, 1 / 60)
  return s
}

describe('spring', () => {
  test('converges to target without overshoot', () => {
    let s = retargetSpring(createSpring(0), 10)
    let previous = s.x
    for (let i = 0; i < 300; i++) {
      s = stepSpring(s, 6, 1 / 60)
      expect(s.x).toBeGreaterThanOrEqual(previous - 1e-9)
      expect(s.x).toBeLessThanOrEqual(10 + 1e-9)
      previous = s.x
    }
    expect(springSettled(s, 1e-3, 1e-3)).toBe(true)
  })

  test('retarget mid-flight keeps position and velocity continuous', () => {
    let s = retargetSpring(createSpring(0), 10)
    for (let i = 0; i < 20; i++) s = stepSpring(s, 6, 1 / 60)
    const { x: xBefore, v: vBefore } = s
    s = retargetSpring(s, -5)
    expect(s.x).toBe(xBefore)
    expect(s.v).toBe(vBefore)
    // One frame later position moved by roughly v·dt — no restart-from-rest jump.
    const next = stepSpring(s, 6, 1 / 60)
    expect(Math.abs(next.x - (xBefore + vBefore / 60))).toBeLessThan(Math.abs(vBefore / 60))
    expect(springSettled(settle(s, 6, 3), 1e-3, 1e-3)).toBe(true)
  })

  test('large dt stays stable (closed form, no explosion)', () => {
    let s = retargetSpring(createSpring(0), 10)
    s = stepSpring(s, 6, 5)
    expect(s.x).toBeCloseTo(10, 3)
    expect(Math.abs(s.v)).toBeLessThan(1e-3)
  })

  test('bearing wraps shortest arc', () => {
    expect(shortestArcDelta(359 - 1)).toBe(-2)
    expect(shortestArcDelta(1 - 359)).toBe(2)
    expect(nearestBearingTarget(359, 1)).toBe(361)
    expect(nearestBearingTarget(721, 359)).toBe(719)
  })
})

const createTestEngine = (options?: {
  teleportDistanceM?: number
  echoWindowMs?: number
  maxDriveJumpPx?: number
  holdAfterTargetMs?: number
}) => {
  const frames: EngineCamera[] = []
  let pending: ((timestampMs: number) => void) | null = null
  let now = 0
  const engine = createCameraEngine({
    applyFrame: (camera) => frames.push(camera),
    teleportDistanceM: options?.teleportDistanceM,
    echoWindowMs: options?.echoWindowMs,
    maxDriveJumpPx: options?.maxDriveJumpPx,
    holdAfterTargetMs: options?.holdAfterTargetMs,
    derivePitch: (zoom) => zoom * 2,
    scheduleFrame: (callback) => {
      pending = callback
      return 1
    },
    cancelFrame: () => {
      pending = null
    },
    now: () => now,
  })
  const advance = (ms: number) => {
    now += ms
  }
  const tick = (dtMs = 16) => {
    const callback = pending
    pending = null
    now += dtMs
    callback?.(now)
  }
  const run = (frameCount: number) => {
    for (let i = 0; i < frameCount && pending; i++) tick()
  }
  return { engine, frames, tick, run, advance, hasPending: () => pending != null }
}

const camera = (center: [number, number], zoom = 14, heading = 0, pitch = 0): EngineCamera => ({
  centerCoordinate: center,
  zoomLevel: zoom,
  heading,
  pitch,
})

describe('cameraEngine', () => {
  test('can resume after a development effect cleanup', () => {
    const { engine, run, hasPending } = createTestEngine()
    engine.reset(camera([21, 52]))
    engine.destroy()
    engine.resume()
    engine.setTarget({ center: [21.001, 52] })

    expect(hasPending()).toBe(true)
    run(600)
    expect(engine.getCamera().centerCoordinate[0]).toBe(21.001)
  })

  test('skips frames a rider could not see, and still lands exactly on target', () => {
    // No post-landing hold: those writes exist to overwrite a native fling and are forced.
    const { engine, frames, run } = createTestEngine({ holdAfterTargetMs: 0 })
    // Pitch parked where `derivePitch` wants it, so heading is the only axis in motion.
    engine.reset(camera([21, 52], 14, 0, 28))
    // A hair of heading: every intermediate frame is far below a pixel of rotation.
    engine.setTarget({ heading: 0.005 })
    run(600)

    // Only the landing write, which has to happen or the map rests off target.
    expect(frames.length).toBe(1)
    expect(frames.at(-1)?.heading).toBeCloseTo(0.005, 6)
    expect(engine.getCamera().heading).toBeCloseTo(0.005, 6)
  })

  test('a heading move worth drawing still animates frame by frame', () => {
    const { engine, frames, run } = createTestEngine({ holdAfterTargetMs: 0 })
    engine.reset(camera([21, 52], 14, 0, 28))
    engine.setTarget({ heading: 45 })
    run(600)

    expect(frames.length).toBeGreaterThan(10)
    expect(frames.at(-1)?.heading).toBeCloseTo(45, 6)
  })

  test('animates to target and idles exactly on it', () => {
    const { engine, frames, run, hasPending } = createTestEngine()
    engine.reset(camera([21, 52]))
    engine.setTarget({ center: [21.001, 52.001], zoom: 15 })
    run(600)
    expect(hasPending()).toBe(false)
    const final = engine.getCamera()
    expect(final.centerCoordinate[0]).toBe(21.001)
    expect(final.centerCoordinate[1]).toBe(52.001)
    expect(final.zoomLevel).toBe(15)
    expect(frames.length).toBeGreaterThan(10)
  })

  test('retarget mid-flight produces no frame-to-frame jump', () => {
    const { engine, frames, run } = createTestEngine()
    engine.reset(camera([21, 52]))
    engine.setTarget({ center: [21.002, 52] })
    run(10)
    engine.setTarget({ center: [20.998, 52] })
    run(600)
    let maxStep = 0
    for (let i = 1; i < frames.length; i++) {
      maxStep = Math.max(
        maxStep,
        Math.abs(frames[i]!.centerCoordinate[0] - frames[i - 1]!.centerCoordinate[0]),
      )
    }
    // Total travel ~0.003°; a restart-free path never moves more per frame
    // than the peak spring speed allows.
    expect(maxStep).toBeLessThan(0.0005)
    expect(engine.getCamera().centerCoordinate[0]).toBe(20.998)
  })

  test('teleport distance snaps instead of animating', () => {
    const { engine, frames, run, hasPending } = createTestEngine({ teleportDistanceM: 1000 })
    engine.reset(camera([21, 52]))
    engine.setTarget({ center: [22, 53] })
    expect(frames[0]!.centerCoordinate).toEqual([22, 53])
    run(600)
    expect(hasPending()).toBe(false)
  })

  test('pitch follows animated zoom via derivePitch', () => {
    const { engine, run } = createTestEngine()
    engine.reset(camera([21, 52], 10, 0, 20))
    engine.setTarget({ zoom: 12 })
    run(1000)
    expect(engine.getCamera().pitch).toBeCloseTo(24, 1)
  })

  test('external drive carries gesture velocity into the next target', () => {
    const { engine, run } = createTestEngine()
    engine.reset(camera([21, 52]))
    // Gesture moves east at 0.001°/frame.
    engine.driveExternal(camera([21.001, 52]), { dtSeconds: 1 / 60, gesture: true })
    engine.driveExternal(camera([21.002, 52]), { dtSeconds: 1 / 60, gesture: true })
    // Release back toward origin: first frames should keep drifting east
    // (momentum), not reverse instantly.
    engine.setTarget({ center: [21, 52] })
    run(2)
    expect(engine.getCamera().centerCoordinate[0]).toBeGreaterThan(21.002)
    run(1000)
    expect(engine.getCamera().centerCoordinate[0]).toBe(21)
  })

  test('untimed drive measures its own dt, so slow gestures carry less momentum', () => {
    const release = (sampleGapMs: number) => {
      const { engine, run, advance } = createTestEngine()
      engine.reset(camera([21, 52]))
      for (const longitude of [21.001, 21.002]) {
        advance(sampleGapMs)
        engine.driveExternal(camera([longitude, 52]), { gesture: true })
      }
      engine.setTarget({ center: [21, 52] })
      run(2)
      return engine.getCamera().centerCoordinate[0]
    }
    // Same drag distance, four times slower: the overshoot past the release
    // point must shrink with the measured speed.
    expect(release(16) - 21.002).toBeGreaterThan(release(64) - 21.002)
  })

  test('first drive sample after a target parks instead of inheriting velocity', () => {
    const { engine, run, advance } = createTestEngine()
    engine.reset(camera([21, 52]))
    engine.setTarget({ center: [21.002, 52] })
    run(10)
    // A gesture grabs the flying camera; the opening sample has no velocity of
    // its own, so releasing it must not continue the old animation.
    advance(16)
    engine.driveExternal(camera([21.001, 52]), { gesture: true })
    engine.setTarget({ center: [21.001, 52] })
    run(2)
    expect(engine.getCamera().centerCoordinate[0]).toBe(21.001)
  })

  test('burst samples do not fabricate velocity', () => {
    // Same finger travel per step, delivered either at a steady 16 ms or as a
    // stalled thread draining four queued touches a millisecond apart.
    const coastAfter = (steps: [gapMs: number, step: number][]) => {
      const { engine, run, advance } = createTestEngine()
      engine.reset(camera([21, 52]))
      let longitude = 21
      for (const [gapMs, step] of steps) {
        longitude += step
        advance(gapMs)
        engine.driveExternal(camera([longitude, 52]), { gesture: true })
      }
      engine.release()
      run(1000)
      return engine.getCamera().centerCoordinate[0] - longitude
    }
    const steady = coastAfter([
      [16, 0.001],
      [16, 0.0001],
      [16, 0.0001],
    ])
    const bursty = coastAfter([
      [16, 0.001],
      [1, 0.000_025],
      [1, 0.000_025],
      [1, 0.000_025],
      [1, 0.000_025],
    ])
    expect(bursty).toBeLessThanOrEqual(steady)
  })

  test('release coasts to rest without reversing', () => {
    const { engine, frames, run, advance } = createTestEngine()
    engine.reset(camera([21, 52]))
    for (const longitude of [21.001, 21.002, 21.003]) {
      advance(16)
      engine.driveExternal(camera([longitude, 52]), { gesture: true })
    }
    engine.release()
    run(1000)
    const drifted = frames.map((f) => f.centerCoordinate[0])
    // Monotone: the glide always moves the way the finger was going.
    for (let i = 1; i < drifted.length; i++) {
      expect(drifted[i]!).toBeGreaterThanOrEqual(drifted[i - 1]! - 1e-12)
    }
    // And it actually coasts past the last sample before settling.
    expect(engine.getCamera().centerCoordinate[0]).toBeGreaterThan(21.003)
    expect(engine.isAnimating()).toBe(false)
  })

  /**
   * Replays the echo race: the engine teleports, and the map answers a frame
   * late with two change events straddling the write — the stale camera first,
   * the written one next. Differentiating that pair reads the engine's own
   * teleport as a driver moving at ~60°/s. Returns the path, because a spring
   * always converges eventually; the damage is the excursion on the way.
   */
  const replayTeleportEchoes = (options: { echoWindowMs?: number; maxDriveJumpPx?: number }) => {
    const { engine, frames, run, advance } = createTestEngine({
      teleportDistanceM: 1000,
      ...options,
    })
    engine.reset(camera([21, 52]))
    engine.setTarget({ center: [22, 52] })
    advance(options.echoWindowMs === 0 ? 400 : 16)
    engine.driveExternal(camera([21, 52]))
    advance(16)
    engine.driveExternal(camera([22, 52]))
    // The next framing target, 68 m back west. It must arrive, not fly past.
    engine.setTarget({ center: [21.999, 52] })
    run(600)
    return {
      settledAt: engine.getCamera().centerCoordinate[0],
      furthestEast: Math.max(...frames.map((f) => f.centerCoordinate[0])),
      lowestZoom: Math.min(...frames.map((f) => f.zoomLevel)),
    }
  }

  test('echoes of a teleport do not become velocity', () => {
    const path = replayTeleportEchoes({ maxDriveJumpPx: Number.POSITIVE_INFINITY })
    expect(path.settledAt).toBeCloseTo(21.999, 6)
    // Nothing is east of the teleport, so a frame past 22° is fabricated
    // momentum carrying the camera beyond where it was ever asked to go.
    expect(path.furthestEast).toBeLessThanOrEqual(22 + 1e-9)
    // And the ballistic zoom follows the centre: a camera flying off-target
    // reads as a long journey and zooms out to fit it.
    expect(path.lowestZoom).toBe(14)
  })

  test('a drive sample that jumps further than a finger could starts a new drive', () => {
    // Same race, but the JS thread stalled long enough that the echoes arrive
    // after the echo window expired — only the discontinuity check is left.
    const path = replayTeleportEchoes({ echoWindowMs: 0 })
    expect(path.settledAt).toBeCloseTo(21.999, 6)
    expect(path.furthestEast).toBeLessThanOrEqual(22 + 1e-9)
    expect(path.lowestZoom).toBe(14)
  })

  test('gesture samples are trusted right after an engine write', () => {
    // The echo window must never swallow a finger: grabbing the map mid-flight
    // still hands control over immediately.
    const { engine, run, advance } = createTestEngine()
    engine.reset(camera([21, 52]))
    engine.setTarget({ center: [21.002, 52] })
    run(5)
    advance(16)
    engine.driveExternal(camera([21.0005, 52]), { gesture: true })
    expect(engine.getCamera().centerCoordinate[0]).toBe(21.0005)
  })

  test('momentum after a throw does not derail a target set mid-fling', () => {
    // Throw the map, then recenter while the fling is still decelerating. The
    // fling keeps reporting camera changes with no finger down; taking them as
    // a driver leaves the camera parked wherever the throw was heading.
    const { engine, run, advance } = createTestEngine({ teleportDistanceM: 1_000_000 })
    engine.reset(camera([21, 52]))
    engine.setTarget({ center: [21.001, 52] })
    run(3)
    for (const longitude of [21.4, 21.7, 21.9]) {
      advance(400) // past the echo window: these are not echoes
      engine.driveExternal(camera([longitude, 52]))
      run(2)
    }
    run(2000)
    expect(engine.getCamera().centerCoordinate[0]).toBeCloseTo(21.001, 6)
  })

  test('a landed target is re-asserted over late fling writes', () => {
    const { engine, frames, run, advance } = createTestEngine({ holdAfterTargetMs: 200 })
    engine.reset(camera([21, 52]))
    engine.snap({ center: [21.001, 52] })
    run(4)
    // Still holding: the loop stays open and keeps writing the target.
    expect(engine.isAnimating()).toBe(true)
    const framesAtTarget = frames.filter((f) => f.centerCoordinate[0] === 21.001).length
    expect(framesAtTarget).toBeGreaterThan(1)
    advance(300)
    run(600)
    expect(engine.isAnimating()).toBe(false)
    expect(engine.getCamera().centerCoordinate[0]).toBe(21.001)
  })

  test('claiming the camera cancels native motion once per claim', () => {
    let cancels = 0
    let pending: ((timestampMs: number) => void) | null = null
    let now = 0
    const engine = createCameraEngine({
      applyFrame: () => {},
      cancelNativeMotion: () => {
        cancels++
      },
      scheduleFrame: (callback) => {
        pending = callback
        return 1
      },
      cancelFrame: () => {
        pending = null
      },
      now: () => now,
    })
    engine.reset(camera([21, 52]))
    engine.setTarget({ center: [21.001, 52] })
    // Retargets inside the same claim have no native animation left to stop.
    engine.setTarget({ center: [21.002, 52] })
    expect(cancels).toBe(1)
    for (let i = 0; i < 2000 && pending; i++) {
      const callback: (timestampMs: number) => void = pending
      pending = null
      now += 16
      callback(now)
    }
    // The camera is the map's again, so the next target cancels afresh.
    engine.setTarget({ center: [21.003, 52] })
    expect(cancels).toBe(2)
  })

  test('the hold releases the camera to a finger immediately', () => {
    const { engine, run, advance } = createTestEngine({ holdAfterTargetMs: 1000 })
    engine.reset(camera([21, 52]))
    engine.setTarget({ center: [21.001, 52] })
    run(600)
    advance(16)
    engine.driveExternal(camera([21.05, 52]), { gesture: true })
    expect(engine.getCamera().centerCoordinate[0]).toBe(21.05)
  })

  test('ballistic transit dips zoom out and returns it on arrival', () => {
    const { engine, frames, run } = createTestEngine({ teleportDistanceM: 100_000 })
    engine.reset(camera([21, 52], 16))
    // ~3.4 km east: below teleport, far enough that zoom 16 can't see the target.
    engine.setTarget({ center: [21.05, 52] })
    run(2000)
    const minZoom = Math.min(...frames.map((f) => f.zoomLevel))
    expect(minZoom).toBeLessThan(15)
    expect(minZoom).toBeGreaterThan(10)
    expect(engine.getCamera().zoomLevel).toBe(16)
    expect(engine.getCamera().centerCoordinate[0]).toBe(21.05)
  })

  test('ballistic false keeps zoom pinned during transit', () => {
    const frames: EngineCamera[] = []
    let pending: ((timestampMs: number) => void) | null = null
    let now = 0
    const engine = createCameraEngine({
      applyFrame: (c) => frames.push(c),
      ballistic: false,
      teleportDistanceM: 100_000,
      scheduleFrame: (callback) => {
        pending = callback
        return 1
      },
      cancelFrame: () => {
        pending = null
      },
    })
    engine.reset(camera([21, 52], 16))
    engine.setTarget({ center: [21.05, 52] })
    for (let i = 0; i < 2000 && pending; i++) {
      const callback: (timestampMs: number) => void = pending
      pending = null
      now += 16
      callback(now)
    }
    expect(Math.min(...frames.map((f) => f.zoomLevel))).toBe(16)
  })

  test('heading crosses 0 via shortest arc', () => {
    const { engine, frames, run } = createTestEngine()
    engine.reset(camera([21, 52], 14, 350))
    engine.setTarget({ heading: 10 })
    run(600)
    expect(engine.getCamera().heading).toBeCloseTo(10, 2)
    for (const frame of frames) {
      const inArc = frame.heading >= 350 || frame.heading <= 10.001
      expect(inArc).toBe(true)
    }
  })
})
