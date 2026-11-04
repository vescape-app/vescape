import type { MapDisplaySnapshot } from 'vescape-core'

interface DisplayTransport {
  command: (id: 'live' | 'bench', command: Record<string, unknown>) => MapDisplaySnapshot
  subscribe: (listener: (snapshot: MapDisplaySnapshot) => void) => { remove: () => void }
}

/** Evaluates native-authored segments only. No measurement, source, freshness or direction logic. */
export class MotionDisplay {
  private snapshot: MapDisplaySnapshot | null = null
  private localAnchor = 0
  private clockOffset: number | null = null
  private listeners = new Set<() => void>()
  constructor(
    readonly id: 'live' | 'bench',
    private transport: DisplayTransport,
    private localNow = () => performance.now(),
  ) {}
  now = () =>
    this.snapshot
      ? this.snapshot.clockMs + (this.localNow() - this.localAnchor) * this.snapshot.clockRate
      : this.localNow()
  duration = (ms: number) => ms / (this.snapshot?.clockRate ?? 1)
  private receive = (snapshot: MapDisplaySnapshot) => {
    if (snapshot.id !== this.id) return
    // Command responses can overtake queued events from the same native owner.
    if (this.snapshot && snapshot.revision <= this.snapshot.revision) return
    this.clockOffset ??= this.localNow() - snapshot.localClockMs
    this.localAnchor = this.clockOffset + snapshot.localClockMs
    this.snapshot = snapshot
    this.notify()
  }
  notify() {
    for (const listener of this.listeners) listener()
  }
  command(command: Record<string, unknown>) {
    const snapshot = this.transport.command(this.id, command)
    this.clockOffset = this.localNow() - snapshot.localClockMs
    this.receive(snapshot)
  }
  connect() {
    const subscription = this.transport.subscribe(this.receive)
    return () => subscription.remove()
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  position(now: number): [number, number] | null {
    const snapshot = this.snapshot
    if (!snapshot) return null
    for (const segment of snapshot.segments) {
      if (now > segment.endMs) continue
      const progress = Math.max(
        0,
        Math.min(1, (now - segment.startMs) / (segment.endMs - segment.startMs)),
      )
      return [
        segment.from[0] + (segment.to[0] - segment.from[0]) * progress,
        segment.from[1] + (segment.to[1] - segment.from[1]) * progress,
      ]
    }
    return snapshot.segments.at(-1)?.to ?? snapshot.position
  }
  segment(now: number) {
    const segment = this.snapshot?.segments.find((candidate) => now < candidate.endMs)
    return {
      from: this.position(now),
      to: segment?.to ?? this.position(now),
      durationMs: segment ? Math.max(0, segment.endMs - now) : 0,
      revision: this.snapshot?.revision ?? 0,
    }
  }
  motionState(now: number) {
    const next = this.snapshot?.segments.find(
      (segment) =>
        segment.endMs > now &&
        (segment.from[0] !== segment.to[0] || segment.from[1] !== segment.to[1]),
    )
    return {
      moving: !!next && now >= next.startMs,
      wakeAfterMs: next && now < next.startMs ? this.duration(next.startMs - now) : null,
    }
  }
  cameraHeading(_now: number) {
    return this.snapshot?.cameraHeading ?? null
  }
  pointHeading(now: number) {
    return now < (this.snapshot?.headingUntilMs ?? -Infinity)
      ? (this.snapshot?.pointHeading ?? null)
      : null
  }
  evidence() {
    return this.snapshot?.diagnostics ?? null
  }
  overlays() {
    return { raw: this.snapshot?.raw ?? null, trail: this.snapshot?.trail ?? [] }
  }
}
