import { cpSync, mkdirSync } from 'node:fs'
import path from 'node:path'

// One list drives both prebuild copies and native-sync invalidation. Replay uses the phone's
// encoders so simulator frames pass through the same decoders as real phone delivery.
const sourceRoot = 'modules/vescape-core/android/src/main/java'
const packageRoot = 'expo/modules/vescapecore'
const sources = [
  'telemetry/UnitPresentation.kt',
  'telemetry/TelemetryLevel.kt',
  'watch/GroupRideFrame.kt',
  'watch/WatchTrail.kt',
  'watch/WatchRouteStatus.kt',
  'watch/WatchFrame.kt',
  'watch/WatchRoute.kt',
] as const

export const wearSharedSources = sources.map((source) => `${sourceRoot}/${packageRoot}/${source}`)

export function copyWearSharedSources(projectRoot: string, wearRoot: string) {
  for (const source of wearSharedSources) {
    // Preserve package directories: phone and wrist have distinct WatchFrame/WatchRoute types
    // with identical filenames. Flattening the copies would overwrite the wrist implementations.
    const target = path.join(wearRoot, 'src/main/java', path.relative(sourceRoot, source))
    mkdirSync(path.dirname(target), { recursive: true })
    cpSync(path.join(projectRoot, source), target)
  }
}
