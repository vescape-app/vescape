import { useCallback, useState } from 'react'
import { AppState } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { getGroundClearanceTilt, getRemoteTiltState } from 'vescape-core'

import { Text } from '@/components/base/Text'

/** Read native's actual remote command only while this screen is visible. No measurement demand. */
export function GroundClearanceTiltStatus() {
  const [status, setStatus] = useState('Reading board tilt…')
  useFocusEffect(
    useCallback(() => {
      let disposed = false
      let timer: ReturnType<typeof setTimeout> | undefined
      let generation = 0
      const read = async (token: number) => {
        try {
          const [binding, tilt] = await Promise.all([
            getGroundClearanceTilt(),
            getRemoteTiltState(),
          ])
          if (disposed || generation !== token) return
          if (tilt?.owner === 'sensor') {
            // @parity /modules/vescape-core/ios/protocol/VescProtocol.swift `REMOTE_TILT_CENTER`
            // @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/protocol/VescProtocol.kt `REMOTE_TILT_CENTER`
            const percent = Math.round(((tilt.value - 128) / 127) * 100)
            setStatus(
              `Board sensor tilt: ${percent > 0 ? '+' : ''}${percent}%${tilt.phase === 'decaying' ? ' · returning to neutral' : ''}`,
            )
          } else {
            setStatus(
              `Board sensor tilt: 0%${binding.release ? ` · ${binding.release.replaceAll('-', ' ')}` : ''}`,
            )
          }
        } catch {
          if (!disposed && generation === token) setStatus('Board sensor tilt unavailable')
        } finally {
          if (!disposed && generation === token)
            timer = setTimeout(() => {
              void read(token)
            }, 250)
        }
      }
      const resume = () => {
        generation++
        clearTimeout(timer)
        if (AppState.currentState === 'active') void read(generation)
      }
      const subscription = AppState.addEventListener('change', resume)
      resume()
      return () => {
        disposed = true
        clearTimeout(timer)
        subscription.remove()
      }
    }, []),
  )
  return <Text>{status}</Text>
}
