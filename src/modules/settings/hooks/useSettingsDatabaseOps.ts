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

  const handleRestoreDatabase = useCallback(async () => {
    setRestoreConfirmVisible(false)
    setRestoreState('running')
    setRestoreResult(null)
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/zip', 'application/x-zip-compressed'],
        copyToCacheDirectory: true,
      })
      if (result.canceled) {
        setRestoreState('idle')
        return
      }
      const uri = result.assets[0]?.uri
      if (!uri) throw new Error('No backup file selected')
      await restoreDatabase(uri)
      setRestoreState('done')
      setRestoreResult('Database restored')
      await reloadRuntime()
    } catch (e) {
      setRestoreState('error')
      setRestoreResult(errorMessage(e, 'Restore failed'))
    }
  }, [])

  const rebuildHint =
    rebuildState === 'error' && rebuildResult
      ? rebuildResult
      : 'Refresh historical data with newest algorithms and settings'
  const rebuildProgressValue =
    rebuildProgress && rebuildProgress.total > 0
      ? Math.min(1, rebuildProgress.current / rebuildProgress.total)
      : 0
  const rebuildProgressLabel = rebuildProgress
    ? `${rebuildProgress.current}/${rebuildProgress.total}`
    : null
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
    rebuildProgressValue,
    rebuildProgressLabel,
    backupState,
    backupHint,
    restoreState,
    restoreHint,
    restoreConfirmVisible,
    setRestoreConfirmVisible,
    handleRebuildBuckets,
    handleBackupDatabase,
    handleRestoreDatabase,
  }
}
