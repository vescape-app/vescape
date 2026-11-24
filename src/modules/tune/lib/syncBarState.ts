type SyncBarVariant =
  | 'loading_config'
  | 'config_error'
  | 'up_to_date'
  | 'connect_to_sync'
  | 'save_later'
  | 'save_and_sync'
  | 'sync_with_board'
  | 'saving'
  | 'syncing'

export interface SyncBarState {
  variant: SyncBarVariant
  dirtyCount: number
  diffCount: number
  diffLabels: string[]
  configError: string | null
}

export function formatDriftSummary(labels: string[], maxVisible = 3): string | null {
  if (labels.length === 0) return null
  if (labels.length <= maxVisible) return labels.join(', ')
  return `${labels.slice(0, maxVisible).join(', ')} +${labels.length - maxVisible} more`
}

export function getSyncBarState(params: {
  hasProfile: boolean
  bleStatus: string
  hasDirtyFields: boolean
  hasBoardDiff: boolean
  dirtyCount: number
  diffCount: number
  diffLabels?: string[]
  loadingConfig: boolean
  configError: string | null
  boardSnapshotReady: boolean
  saving: boolean
  syncing: boolean
}): SyncBarState | null {
  const {
    hasProfile,
    bleStatus,
    hasDirtyFields,
    hasBoardDiff,
    dirtyCount,
    diffCount,
    diffLabels = [],
    loadingConfig,
    configError,
    boardSnapshotReady,
    saving,
    syncing,
  } = params
  if (!hasProfile) return null
  if (saving) return { variant: 'saving', dirtyCount, diffCount, diffLabels, configError: null }
  if (syncing) return { variant: 'syncing', dirtyCount, diffCount, diffLabels, configError: null }
  const connected = bleStatus === 'connected'
  if (hasDirtyFields && connected && boardSnapshotReady) {
    return { variant: 'save_and_sync', dirtyCount, diffCount, diffLabels, configError: null }
  }
  if (hasDirtyFields) {
    return { variant: 'save_later', dirtyCount, diffCount, diffLabels, configError }
  }
  if (loadingConfig) {
    return { variant: 'loading_config', dirtyCount, diffCount, diffLabels, configError: null }
  }
  if (configError) {
    return { variant: 'config_error', dirtyCount, diffCount, diffLabels, configError }
  }
  if (hasBoardDiff && connected && boardSnapshotReady) {
    return { variant: 'sync_with_board', dirtyCount, diffCount, diffLabels, configError: null }
  }
  if (!connected) {
    return { variant: 'connect_to_sync', dirtyCount, diffCount, diffLabels, configError: null }
  }
  if (!boardSnapshotReady) {
    return { variant: 'loading_config', dirtyCount, diffCount, diffLabels, configError: null }
  }
  return { variant: 'up_to_date', dirtyCount, diffCount, diffLabels, configError: null }
}
