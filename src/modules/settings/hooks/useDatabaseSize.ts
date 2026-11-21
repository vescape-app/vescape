import { useCallback, useEffect, useState } from 'react'
import { getDatabaseSizeBytes } from 'vescape-core'

export interface DatabaseSize {
  bytes: number | null
  error: string | null
  refresh: () => void
}

export function useDatabaseSize(): DatabaseSize {
  const [bytes, setBytes] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    getDatabaseSizeBytes()
      .then((nextBytes) => {
        setBytes(nextBytes)
        setError(null)
      })
      .catch(() => setError('Database size could not be read.'))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { bytes, error, refresh }
}
