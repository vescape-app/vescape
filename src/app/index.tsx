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
  const startGpsTracking = useBleStore((s) => s.startGpsTracking)
  const { status: permStatus, request } = usePermissions()

  const connection = useBoardConnection()

  useBleAppLifecycle()

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void request()
  }, [request])

  useEffect(() => {
    if (permStatus === 'granted') {
      startGpsTracking()
    }
  }, [permStatus, startGpsTracking])

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
    backgroundColor: theme.palette.slate.surfaceDeep,
  },
})
