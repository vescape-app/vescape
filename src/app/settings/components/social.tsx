import { useState } from 'react'
import { StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button } from '@/components/base/Button'
import { PageScrollView } from '@/components/base/PageScrollView'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ChipRow, ToggleRow } from '@/components/dev/ShowcaseControls'
import { theme } from '@/constants/theme'
import { FriendRow } from '@/modules/profile/components/FriendRow'
import { PublicRideRow } from '@/modules/group-ride/components/FriendRides'

const STATUSES = {
  riding: 'Riding now',
  online: 'Online 12m ago',
  never: 'Not online yet',
  request: 'Wants to be friends',
  none: null,
} as const

export default function SocialShowcase() {
  const [status, setStatus] = useState<keyof typeof STATUSES>('riding')
  const [nationality, setNationality] = useState(true)
  const [action, setAction] = useState(true)
  const [longNick, setLongNick] = useState(false)
  const [rideShown, setRideShown] = useState(false)

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <PageScrollView contentContainerStyle={styles.content}>
        <ShowcaseCard
          name="FriendRow"
          controls={
            <>
              <ChipRow
                label="status"
                options={Object.keys(STATUSES)}
                selected={status}
                onSelect={(value) => setStatus(value as keyof typeof STATUSES)}
              />
              <ToggleRow label="nationality" value={nationality} onToggle={setNationality} />
              <ToggleRow label="action" value={action} onToggle={setAction} />
              <ToggleRow label="long nick" value={longNick} onToggle={setLongNick} />
            </>
          }
        >
          <FriendRow
            nick={longNick ? 'the_longest_nick_ok' : 'kuba_rides'}
            nationality={nationality ? 'PL' : null}
            status={STATUSES[status]}
            riding={status === 'riding'}
            trailing={
              action ? (
                <Button
                  label="Add friend"
                  size="sm"
                  variant="secondary"
                  onPress={() => undefined}
                />
              ) : null
            }
          />
        </ShowcaseCard>
        <ShowcaseCard
          name="PublicRideRow"
          controls={<ToggleRow label="shown" value={rideShown} onToggle={setRideShown} />}
        >
          <PublicRideRow
            ride={{ startedAt: '2026-11-14T16:05:00.000Z', endedAt: '2026-11-14T17:12:00.000Z' }}
            shown={rideShown}
            onPress={() => setRideShown((shown) => !shown)}
          />
        </ShowcaseCard>
      </PageScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.neutral.bg },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
})
