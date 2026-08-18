import { useCallback, useEffect, useState } from 'react'
import { getDatabaseSizeBytes } from 'vescape-core'

export interface DatabaseSize {
  /** Bytes the database occupies, or null until native has answered. */
  bytes: number | null
  refresh: () => void
}

/**
 * How much space the database takes, for surfaces that only want the number — the Settings
 * Drawer's storage cell — without the backup/restore/rebuild machinery around it.
 */
export function useDatabaseSize(): DatabaseSize {
  const [bytes, setBytes] = useState<number | null>(null)

  const refresh = useCallback(() => {
    getDatabaseSizeBytes()
      .then(setBytes)
      .catch(() => {})
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { bytes, refresh }
}
