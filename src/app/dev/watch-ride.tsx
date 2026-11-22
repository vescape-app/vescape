import { useEffect } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { addLocationListener, startDebugReplay } from 'vescape-core'

import { distanceMeters } from '@/helpers/mapGeometry'
import { useBoardStore } from '@/modules/board/store/boardStore'
import { useMapStore } from '@/modules/map/store/mapStore'

const REPLAY_FIX_RADIUS_M = 5_000
const FIRST_FIX_TIMEOUT_MS = 60_000
const WATCH_RIDE_BOARD_NAME = 'Watch Ride Board'

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

async function selectReplayBoard() {
  const store = useBoardStore.getState()
  await store.load()
  const boardId =
    useBoardStore.getState().activeBoardId ??
    (await store.addBoard({ name: WATCH_RIDE_BOARD_NAME })).id
  useBoardStore.getState().setActiveBoard(boardId)
}

async function startWatchRide(
  replay: string,
  latitude: number,
  longitude: number,
  navigation: boolean,
) {
  await selectReplayBoard()
  await startDebugReplay(replay)
  if (!navigation) {
    console.log(`[watch-ride] ${replay} running, telemetry only`)
    return
  }
  await firstReplayedFix({ latitude, longitude })
  await useMapStore.getState().setDirectionPoint(latitude, longitude)
  console.log(`[watch-ride] ${replay} running, Direction Point ${latitude}, ${longitude}`)
}

export default function WatchRideLink() {
  const { replay, lat, lon, navigation } = useLocalSearchParams<{
    replay: string
    lat: string
    lon: string
    navigation?: string
  }>()
  const router = useRouter()

  useEffect(() => {
    const latitude = Number(lat)
    const longitude = Number(lon)
    if (__DEV__ && replay && Number.isFinite(latitude) && Number.isFinite(longitude)) {
      console.log(`[watch-ride] ${replay} received`)
      startWatchRide(replay, latitude, longitude, navigation !== 'off').catch((error: unknown) =>
        console.warn('[watch-ride] failed', error),
      )
    }
    if (router.canDismiss()) router.dismissAll()
    router.replace('/')
  }, [replay, lat, lon, navigation, router])

  return null
}
