import { router, useLocalSearchParams } from 'expo-router'
import { useLayoutEffect } from 'react'

import { resolveSharedLocation } from '@/modules/map/lib/sharedLocationResolve'
import { useMapStore } from '@/modules/map/store/mapStore'

/**
 * Where a location shared from another app lands. Both platforms funnel their share payload into
 * the same `vescape://shared-location?text=…` link — Android from the share intent, iOS from the
 * share extension — so there is one place that decides what an incoming payload means.
 *
 * Nothing is rendered: the rider asked another app to open Vescape at a place, so the map is the
 * answer, and this screen exists only long enough to read the payload and hand it over.
 *
 * @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/sharing/ShareTargetActivity.kt
 * @parity /targets/shared-location/ShareLocationViewController.swift
 */
export default function SharedLocationScreen() {
  const { text } = useLocalSearchParams<{ text?: string }>()

  useLayoutEffect(() => {
    const { receiveSharedLocation, failSharedLocation } = useMapStore.getState()
    // Start resolution before replacing the route: Expo Router may synchronously unmount this
    // screen during `replace`, but the request must continue while the real map becomes visible.
    const resolution = resolveSharedLocation(text ?? '').then((location) => {
      // An unreadable payload is still an answer, and it is the map that has to say so — the
      // banner there is where the rider is already looking.
      if (location) receiveSharedLocation(location)
      else failSharedLocation()
    })
    void resolution
    // Leave the plumbing route before React Native paints it.
    router.replace('/')
  }, [text])

  return null
}
