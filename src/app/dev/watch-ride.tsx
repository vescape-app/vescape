import { useEffect } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { addLocationListener, startDebugReplay } from 'vescape-core'

import { distanceMeters } from '@/helpers/mapGeometry'
import { useMapStore } from '@/modules/map/store/mapStore'

/**
 * A fix this close to the Direction Point belongs to the replayed ride, not to whatever the phone
 * reported before the replay took position over. The fixture targets sit on their own track.
 */
const REPLAY_FIX_RADIUS_M = 5_000
const FIRST_FIX_TIMEOUT_MS = 60_000

/** Resolves on the first fix of the replayed ride; the replay keeps emitting, so none is missed. */
function firstReplayedFix(target: { latitude: number; longitude: number }) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      subscription.remove()
      reject(new Error(`no replayed fix within ${FIRST_FIX_TIMEOUT_MS} ms`))
    }, FIRST_FIX_TIMEOUT_MS)
    const subscription = addLocationListener((fix) => {
      if (distanceMeters(fix, target) > REPLAY_FIX_RADIUS_M) return
      clearTimeout(timeout)
      subscription.remove()
      resolve()
    })
  })
}

/**
 * Starts the replay, then sets the Direction Point once the first replayed fix lands. Directions
 * plans from the rider's current position, so a target set earlier would be planned from the
 * emulator's default location.
 */
async function startWatchRide(replay: string, latitude: number, longitude: number) {
  await startDebugReplay(replay)
  await firstReplayedFix({ latitude, longitude })
  // The store, not the native call alone, so the phone shows the same Navigation a rider's tap makes.
  await useMapStore.getState().setDirectionPoint(latitude, longitude)
  console.log(`[watch-ride] ${replay} running, Direction Point ${latitude}, ${longitude}`)
}

/**
 * Dev-only deep link behind `wear:ride` / `watchos:ride`:
 * `vescape://dev/watch-ride?replay=<recording>&lat=<lat>&lon=<lon>`. Release builds ignore it.
 */
export default function WatchRideLink() {
  const { replay, lat, lon } = useLocalSearchParams<{ replay: string; lat: string; lon: string }>()
  const router = useRouter()

  useEffect(() => {
    const latitude = Number(lat)
    const longitude = Number(lon)
    if (__DEV__ && replay && Number.isFinite(latitude) && Number.isFinite(longitude)) {
      // The ride script stops resending the link on this line; starting can take a minute more.
      console.log(`[watch-ride] ${replay} received`)
      startWatchRide(replay, latitude, longitude).catch((error: unknown) =>
        console.warn('[watch-ride] failed', error),
      )
    }
    // Back to the bare main screen, as DevBadge's replay does: the ride is watched on the map.
    if (router.canDismiss()) router.dismissAll()
    router.replace('/')
  }, [replay, lat, lon, router])

  return null
}
