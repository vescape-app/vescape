import { acquireLiveDisplay, liveMotionDisplay } from '@/modules/map/lib/liveMotion/liveDisplay'
import { useEffect, useState } from 'react'

/** A visible renderer subscribes to native segments. Input ownership stays entirely native. */
class PhoneMapDisplay {
  readonly motion = liveMotionDisplay
  active = false
  now = this.motion.now
  duration = this.motion.duration
  subscribe = this.motion.subscribe
  activate(active: boolean) {
    this.active = active
    this.motion.notify()
  }
}
export function useLiveGpsMotion(active: boolean) {
  const [runtime] = useState(() => new PhoneMapDisplay())
  useEffect(() => {
    runtime.activate(active)
    if (!active) return
    const release = acquireLiveDisplay()
    return () => {
      runtime.activate(false)
      release()
    }
  }, [active, runtime])
  return runtime
}
