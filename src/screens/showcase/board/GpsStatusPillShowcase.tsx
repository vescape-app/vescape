import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import type { GpsPhase, LocationEvent } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ChipRow, ToggleRow } from '@/components/dev/ShowcaseControls'
import { GpsStatusPill } from '@/modules/board/components/GpsStatusPill'
import { deriveGpsStatusBadge, GPS_STALE_FIX_TIMEOUT_MS } from '@/modules/board/lib/gpsStatusBadge'
import { theme } from '@/constants/theme'

const NOW = 1_700_000_000_000
const PHASES: GpsPhase[] = ['idle', 'starting', 'active', 'error']

function fix({ precise, ageMs }: { precise: boolean; ageMs: number }): LocationEvent {
  return {
    latitude: 52.23,
    longitude: 21.01,
    speedMps: 4,
    bearingDeg: 90,
    courseDeg: 90,
    courseSourceTimestamp: NOW - ageMs,
    accuracyM: precise ? 6 : 240,
    altitudeM: 110,
    timestamp: NOW - ageMs,
    precise,
  }
}

/** Every state the badge can reach, including the healthy one where it renders nothing. */
export function GpsStatusPillShowcase() {
  const [phase, setPhase] = useState<GpsPhase>('active')
  const [hasFix, setHasFix] = useState(true)
  const [precise, setPrecise] = useState(true)
  const [stale, setStale] = useState(false)

  const badge = deriveGpsStatusBadge({
    phase,
    latestFix: hasFix ? fix({ precise, ageMs: stale ? GPS_STALE_FIX_TIMEOUT_MS : 1_000 }) : null,
    nowMs: NOW,
  })

  return (
    <ShowcaseCard
      name="GpsStatusPill"
      controls={
        <>
          <ChipRow
            label="phase"
            options={PHASES}
            selected={phase}
            onSelect={(next) => setPhase(next as GpsPhase)}
          />
          <ToggleRow label="has a fix" value={hasFix} onToggle={setHasFix} />
          <ToggleRow label="precise fix" value={precise} onToggle={setPrecise} />
          <ToggleRow label="fix gone stale" value={stale} onToggle={setStale} />
        </>
      }
    >
      <View style={styles.stage}>
        {badge ? (
          <GpsStatusPill badge={badge} onPress={() => {}} />
        ) : (
          <Text style={styles.healthy}>Healthy GPS — no badge</Text>
        )}
      </View>
    </ShowcaseCard>
  )
}

const styles = StyleSheet.create({
  stage: {
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
  },
  healthy: {
    fontFamily: theme.font('500'),
    fontSize: 11,
    color: theme.neutral.textMuted,
  },
})
