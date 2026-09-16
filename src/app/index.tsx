import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'

import { useBoardStore } from '@/modules/board/store/boardStore'
import { useBleStore } from '@/modules/board/store/bleStore'
import { usePermissions } from '@/modules/settings/hooks/usePermissions'
import { useBleAppLifecycle } from '@/modules/board/hooks/useBleAppLifecycle'
import { useBoardConnection } from '@/modules/board/hooks/useBoardConnection'
import { MainScreen } from '@/screens/main/MainScreen'
import { theme } from '@/constants/theme'

export default function IndexRoute() {
  const load = useBoardStore((s) => s.load)
  const boardsLoaded = useBoardStore((s) => s.hasLoaded)
  const refreshGpsDemand = useBleStore((s) => s.refreshGpsDemand)
  const { status: permStatus, request } = usePermissions()

  const connection = useBoardConnection()

  useBleAppLifecycle()

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void request()
  }, [request])

  // Native decides whether GPS actually runs (see `GpsPowerMode`); a grant is just the one input
  // it cannot observe for itself, so the answer is re-resolved once the rider has given it.
  useEffect(() => {
    if (permStatus === 'granted') {
      refreshGpsDemand()
    }
  }, [permStatus, refreshGpsDemand])

  return (
    <View style={styles.container}>
      <MainScreen
        activeBoard={connection.activeBoard}
        activeBoardId={connection.activeBoardId}
        boards={connection.boards}
        boardsLoaded={boardsLoaded}
        bleStatus={connection.bleStatus}
        onStopScan={connection.handleCancel}
        onRetryConnect={connection.handleRetryConnect}
        onSelectBoard={(id) => void connection.handleSelectBoard(id)}
        onAddBoard={connection.handleAddBoard}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.neutral.surfaceDeep,
  },
})
