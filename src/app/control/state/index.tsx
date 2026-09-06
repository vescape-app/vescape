import { StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'

import { ControlDetailLayout } from '@/modules/board/components/ControlDetailLayout'
import { BoardConfigSection } from '@/modules/board/components/BoardConfigSection'
import { STATE_CONFIG_ROWS } from '@/modules/board/constants/boardConfigRows'
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
      <BoardConfigSection rows={STATE_CONFIG_ROWS} />
    </ControlDetailLayout>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.neutral.surface,
    borderRadius: 10,
    padding: 16,
    gap: 8,
  },
  label: {
    color: theme.neutral.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  stateName: {
    color: theme.neutral.textPrimary,
    fontSize: 28,
    fontFamily: 'monospace',
    fontWeight: '600',
  },
})
