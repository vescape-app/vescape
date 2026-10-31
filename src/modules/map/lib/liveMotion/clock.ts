/** Renderer clock. Replay rate changes preserve local display time; original fix timestamps are
 * used only by the motion controller for ordering/cadence, never rewritten by this adapter. */
export class DisplayClock {
  private localAnchor = 0
  private displayAnchor = 0
  private rate = 1
  private sourceAnchor = 0
  private sourceDisplayAnchor = 0
  private lastSourceClock = -Infinity
  now(localMs: number) {
    return this.displayAnchor + (localMs - this.localAnchor) * this.rate
  }
  configure(rate: number, localMs: number) {
    this.displayAnchor = this.now(localMs)
    this.localAnchor = localMs
    this.rate = Number.isFinite(rate) ? Math.max(0.1, Math.min(100, rate)) : 1
  }
  duration(displayMs: number) {
    return displayMs / this.rate
  }
  /** An initial native snapshot outranks queued emissions from before a renderer resumed. */
  observeSource(sourceMs: number, rate: number, localMs: number, reset = false) {
    if (!reset && sourceMs <= this.lastSourceClock) return false
    this.configure(rate, localMs)
    this.lastSourceClock = sourceMs
    this.sourceAnchor = sourceMs
    this.sourceDisplayAnchor = this.now(localMs)
    return true
  }
  age(timestamp: number, localMs: number) {
    return Math.max(0, this.sourceTime(localMs) - timestamp)
  }
  sourceTime(localMs: number) {
    return this.sourceAnchor + this.now(localMs) - this.sourceDisplayAnchor
  }
}
