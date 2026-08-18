import { router, useLocalSearchParams } from 'expo-router'
import { useEffect } from 'react'

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

  useEffect(() => {
    const abortController = new AbortController()
    const { receiveSharedLocation, failSharedLocation } = useMapStore.getState()

    void resolveSharedLocation(text ?? '', { signal: abortController.signal })
      .then((location) => {
        if (abortController.signal.aborted) return
        // An unreadable payload is still an answer, and it is the map that has to say so — the
        // banner there is where the rider is already looking.
        if (location) receiveSharedLocation(location)
        else failSharedLocation()
      })
      .finally(() => {
        if (abortController.signal.aborted) return
        // Replace, not push: a share is an entry point, not a step the rider can go back to.
        router.replace('/')
      })

    return () => abortController.abort()
  }, [text])

  return null
}
