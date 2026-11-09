import { Pressable, StyleSheet, View } from 'react-native'
import { devClearRideNotice, devPostRideNotice, type RideNotice } from 'vescape-core'

import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { offsetCoordinate } from '@/helpers/mapGeometry'
import { useLocationStore } from '@/modules/location/store/locationStore'
import { useRideNoticesStore } from '@/modules/ride-notices/store/rideNoticesStore'

const SEVERITIES: RideNotice['severity'][] = ['info', 'warning', 'critical']
/** Used when there is no fix yet, so a located notice is still demoable. */
const FALLBACK_POSITION: [number, number] = [21.0122, 52.2297]
const TEST_TTL_MS = 10 * 60_000

const TITLES: Record<RideNotice['severity'], string> = {
  info: 'Rider waiting ahead',
  warning: 'Rider needs a hand',
  critical: 'Rider down',
}

/** Posts test notices through the native Ride Notice engine; real sources land in later slices. */
export function RideNoticeProbe() {
  const notices = useRideNoticesStore((s) => s.notices)
  const lastFix = useLocationStore((s) => s.liveLocationHistory.at(-1) ?? null)

  const post = (severity: RideNotice['severity'], located: boolean) => {
    const now = Date.now()
    const [lng, lat] = offsetCoordinate(
      lastFix ? [lastFix.longitude, lastFix.latitude] : FALLBACK_POSITION,
      Math.random() * 360,
      300 + Math.random() * 1500,
    )
    devPostRideNotice({
      key: `dev:${severity}:${located ? 'located' : 'plain'}`,
      revision: String(now),
      severity,
      title: TITLES[severity],
      details: located ? 'Test notice with a location.' : 'Test notice without a location.',
      postedAt: now,
      expiresAt: now + TEST_TTL_MS,
      ...(located ? { lat, lng } : {}),
    })
  }

  return (
    <>
      <Text style={styles.sectionTitle}>Ride Notices</Text>
      <View style={styles.card}>
        <Text style={styles.hint}>
          Posts a test notice through the native engine. Re-posting a button bumps its revision,
          showing it again if dismissed. Expires in 10 min.
        </Text>
        {[true, false].map((located) => (
          <View key={String(located)} style={styles.row}>
            {SEVERITIES.map((severity) => (
              <Pressable
                key={severity}
                style={styles.button}
                onPress={() => post(severity, located)}
              >
                <Text style={styles.buttonText}>
                  {severity}
                  {located ? ' + loc' : ''}
                </Text>
              </Pressable>
            ))}
          </View>
        ))}
        {notices.map((notice) => (
          <View key={notice.id} style={styles.noticeRow}>
            <Text style={styles.noticeText} numberOfLines={1}>
              #{notice.id} r{notice.rev} · {notice.severity} · {notice.key}
            </Text>
            <Pressable onPress={() => devClearRideNotice(notice.key)}>
              <Text style={styles.clear}>Clear</Text>
            </Pressable>
          </View>
        ))}
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  sectionTitle: {
    color: theme.neutral.textMuted,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 8,
    marginBottom: 4,
    marginLeft: 4,
  },
  card: {
    backgroundColor: theme.neutral.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    padding: 14,
  },
  hint: {
    color: theme.neutral.textDim,
    fontSize: 11,
    lineHeight: 16,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  button: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: theme.neutral.surfaceDeep,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    borderRadius: 8,
    paddingVertical: 12,
  },
  buttonText: {
    color: theme.neutral.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  noticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  noticeText: {
    flex: 1,
    color: theme.neutral.textSecondary,
    fontSize: 12,
  },
  clear: {
    color: theme.status.error.text,
    fontSize: 12,
    fontWeight: '700',
  },
})
