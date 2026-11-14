import { useState } from 'react'
import { StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { RideNotice } from 'vescape-core'

import { PageScrollView } from '@/components/base/PageScrollView'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ChipRow, ToggleRow } from '@/components/dev/ShowcaseControls'
import { theme } from '@/constants/theme'
import { DistanceUnitContext } from '@/hooks/useDistanceUnit'
import { RideNoticeCard } from '@/modules/ride-notices/components/RideNoticeCard'

const OWN_LOCATION = { latitude: 52.2297, longitude: 21.0122 }

const TITLES: Record<RideNotice['severity'], { title: string; details: string }> = {
  critical: { title: 'Rider down', details: 'Kuba raised a signal 1.2 km behind you.' },
  warning: { title: 'Rider needs a hand', details: 'Ola stopped and asked for help.' },
  info: { title: 'Rider waiting ahead', details: 'Marta is waiting at the crossing.' },
}

export default function NoticesShowcase() {
  const [severity, setSeverity] = useState<RideNotice['severity']>('critical')
  const [located, setLocated] = useState(true)
  const [more, setMore] = useState(true)
  const [distanceUnit, setDistanceUnit] = useState<'km' | 'mi'>('km')
  const [dismissed, setDismissed] = useState(false)

  const notice: RideNotice = {
    id: 1,
    rev: 1,
    key: 'showcase',
    severity,
    ...TITLES[severity],
    postedAt: Date.now() - 4 * 60_000,
    location: located ? { lat: 52.2405, lng: 21.0122 } : null,
    expiresAt: null,
  }

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <PageScrollView contentContainerStyle={styles.content}>
        <DistanceUnitContext value={distanceUnit}>
          <ShowcaseCard
            name="RideNoticeCard"
            controls={
              <>
                <ChipRow
                  label="severity"
                  options={['critical', 'warning', 'info']}
                  selected={severity}
                  onSelect={(value) => setSeverity(value as RideNotice['severity'])}
                />
                <ToggleRow label="location" value={located} onToggle={setLocated} />
                <ToggleRow label="+N more" value={more} onToggle={setMore} />
                <ChipRow
                  label="units"
                  options={['km', 'mi']}
                  selected={distanceUnit}
                  onSelect={(value) => setDistanceUnit(value as 'km' | 'mi')}
                />
                <ToggleRow label="dismissed" value={dismissed} onToggle={setDismissed} />
              </>
            }
          >
            {dismissed ? null : (
              <RideNoticeCard
                notice={notice}
                moreCount={more ? 2 : 0}
                ownLocation={OWN_LOCATION}
                onDismiss={() => setDismissed(true)}
                onShowOnMap={() => undefined}
              />
            )}
          </ShowcaseCard>
        </DistanceUnitContext>
      </PageScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.neutral.bg },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
})
