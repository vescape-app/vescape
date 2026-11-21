import { cpSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const sourceRoot = 'modules/vescape-core/android/src/main/java'
const packageRoot = 'expo/modules/vescapecore'
const sources = [
  'telemetry/UnitPresentation.kt',
  'telemetry/TelemetryLevel.kt',
  'watch/GroupRideFrame.kt',
  'watch/RideNoticeFrame.kt',
  'watch/WatchTrail.kt',
  'watch/WatchMapTile.kt',
  'watch/WatchRouteStatus.kt',
  'watch/WatchFrame.kt',
  'watch/WatchRoute.kt',
] as const

export const wearSharedSources = sources.map((source) => `${sourceRoot}/${packageRoot}/${source}`)

export function copyWearSharedSources(projectRoot: string, wearRoot: string) {
  for (const source of wearSharedSources) {
    const target = path.join(wearRoot, 'src/main/java', path.relative(sourceRoot, source))
    mkdirSync(path.dirname(target), { recursive: true })
    cpSync(path.join(projectRoot, source), target)
  }
}
