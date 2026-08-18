import { StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'

import { ControlDetailLayout } from '@/modules/board/components/ControlDetailLayout'
import { useBleStore } from '@/modules/board/store/bleStore'
import { theme } from '@/constants/theme'
import { DASH } from '@/helpers/format'

export default function StateScreen() {
  const hasLiveTelemetry = useBleStore((s) => s.liveStatus.boardLastPacketAt != null)

  return (
    <ControlDetailLayout title="State" controlId="state">
      <View style={styles.card}>
        <Text style={styles.label}>BOARD STATE</Text>
        <Text style={styles.stateName}>{hasLiveTelemetry ? 'LIVE' : DASH}</Text>
      </View>
    </ControlDetailLayout>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.palette.slate.surface,
    borderRadius: 10,
    padding: 16,
    gap: 8,
  },
  label: {
    color: theme.palette.slate.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  stateName: {
    color: theme.palette.slate.textPrimary,
    fontSize: 28,
    fontFamily: 'monospace',
    fontWeight: '600',
  },
})
