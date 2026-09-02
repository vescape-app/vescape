import { useCallback, useEffect, useState } from 'react'
import { DevSettings } from 'react-native'
import * as DocumentPicker from 'expo-document-picker'
import * as Sharing from 'expo-sharing'
import * as Updates from 'expo-updates'
import {
  addTelemetryRebuildProgressListener,
  backupDatabase,
  rebuildTelemetryBuckets,
  restoreDatabase,
} from 'vescape-core'

import { formatBytes } from '@/helpers/format'
import { useDatabaseSize } from '@/modules/settings/hooks/useDatabaseSize'
import { errorMessage } from '@/helpers/error'

type OpState = 'idle' | 'running' | 'done' | 'error'

// Restore hot-swaps the native DB; reloading the JS runtime forces every store
// to re-init from the fresh database. No-ops in Expo Go fall back to DevSettings.
async function reloadRuntime() {
  try {
    await Updates.reloadAsync()
  } catch {
    DevSettings.reload()
  }
}

export function useSettingsDatabaseOps() {
  const { bytes: dbSize, refresh: refreshDatabaseSize } = useDatabaseSize()
  const [rebuildState, setRebuildState] = useState<OpState>('idle')
  const [rebuildResult, setRebuildResult] = useState<string | null>(null)
  const [backupState, setBackupState] = useState<OpState>('idle')
  const [backupResult, setBackupResult] = useState<string | null>(null)
  const [restoreState, setRestoreState] = useState<OpState>('idle')
  const [restoreResult, setRestoreResult] = useState<string | null>(null)
  const [restoreConfirmVisible, setRestoreConfirmVisible] = useState(false)
  const [pendingRestore, setPendingRestore] = useState<{ uri: string; name: string } | null>(null)
  const [rebuildProgress, setRebuildProgress] = useState<{
    current: number
    total: number
  } | null>(null)

  useEffect(() => {
    const subscription = addTelemetryRebuildProgressListener((event) => {
      setRebuildProgress(event)
    })
    return () => subscription.remove()
  }, [])

  const handleRebuildBuckets = useCallback(async () => {
    setRebuildState('running')
    setRebuildResult(null)
    setRebuildProgress(null)
    try {
      await rebuildTelemetryBuckets()
      setRebuildState('done')
      setRebuildResult(null)
      setRebuildProgress(null)
    } catch (e) {
      setRebuildState('error')
      setRebuildResult(errorMessage(e, 'Unknown error'))
      setRebuildProgress(null)
    }
  }, [])

  const handleBackupDatabase = useCallback(async () => {
    setBackupState('running')
    setBackupResult(null)
    try {
      const backup = await backupDatabase()
      await Sharing.shareAsync(backup.uri, {
        mimeType: 'application/zip',
        dialogTitle: 'Save or send database backup',
        UTI: 'com.pkware.zip-archive',
      })
      setBackupState('done')
      setBackupResult(`${backup.name} (${formatBytes(backup.sizeBytes)})`)
      refreshDatabaseSize()
    } catch (e) {
      setBackupState('error')
      setBackupResult(errorMessage(e, 'Backup failed'))
    }
  }, [refreshDatabaseSize])

  // Pick first, confirm second. iOS will not present the document picker while the confirm card's
  // modal view controller is on screen or mid-dismissal: the picker never appears and
  // `getDocumentAsync` never settles, stranding the row on "Restoring...". Nothing is presented
  // over a modal this way, so there is no dismissal to race.
  const handleRestoreDatabase = useCallback(async () => {
    setRestoreResult(null)
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/zip', 'application/x-zip-compressed'],
        copyToCacheDirectory: true,
      })
      if (result.canceled) return
      const asset = result.assets[0]
      if (!asset?.uri) throw new Error('No backup file selected')
      setPendingRestore({ uri: asset.uri, name: asset.name ?? 'backup.zip' })
      setRestoreConfirmVisible(true)
    } catch (e) {
      setRestoreState('error')
      setRestoreResult(errorMessage(e, 'Restore failed'))
    }
  }, [])

  const cancelRestore = useCallback(() => {
    setRestoreConfirmVisible(false)
    setPendingRestore(null)
  }, [])

  const handleConfirmRestore = useCallback(async () => {
    if (!pendingRestore) return
    setRestoreConfirmVisible(false)
    setRestoreState('running')
    setRestoreResult(null)
    try {
      await restoreDatabase(pendingRestore.uri)
      setRestoreState('done')
      setRestoreResult('Database restored')
      setPendingRestore(null)
      await reloadRuntime()
    } catch (e) {
      setRestoreState('error')
      setRestoreResult(errorMessage(e, 'Restore failed'))
      setPendingRestore(null)
    }
  }, [pendingRestore])

  const rebuildHint =
    rebuildState === 'error' && rebuildResult
      ? rebuildResult
      : 'Refresh historical data with newest algorithms and settings'
  const backupHint =
    backupState === 'error' && backupResult
      ? backupResult
      : backupState === 'done' && backupResult
        ? backupResult
        : 'Create a shareable zip for debugging'
  const restoreHint =
    restoreState === 'error' && restoreResult
      ? restoreResult
      : restoreState === 'done' && restoreResult
        ? restoreResult
        : 'Replace current database from backup zip'

  return {
    dbSize,
    rebuildState,
    rebuildHint,
    rebuildProgress,
    backupState,
    backupHint,
    restoreState,
    restoreHint,
    restoreConfirmVisible,
    pendingRestoreName: pendingRestore?.name ?? null,
    cancelRestore,
    handleRebuildBuckets,
    handleBackupDatabase,
    handleRestoreDatabase,
    handleConfirmRestore,
  }
}
