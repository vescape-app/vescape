import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { searchMapResults, type MapSearchResult } from '@/modules/map/lib/search'

export function useMapSearch({
  searchOpen,
  proximityLocation,
}: {
  searchOpen: boolean
  proximityLocation: { latitude: number; longitude: number } | null | undefined
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<MapSearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const searchCacheRef = useRef<Map<string, MapSearchResult[]>>(new Map())
  const searchRequestIdRef = useRef(0)
  const normalizedSearchQuery = searchQuery.trim()
  const weatherLatitude = proximityLocation?.latitude ?? null
  const weatherLongitude = proximityLocation?.longitude ?? null
  const searchProximity = useMemo(
    () =>
      weatherLatitude == null || weatherLongitude == null
        ? null
        : { latitude: weatherLatitude, longitude: weatherLongitude },
    [weatherLatitude, weatherLongitude],
  )
  const searchProximityKey =
    weatherLatitude == null || weatherLongitude == null
      ? 'none'
      : `${weatherLatitude.toFixed(4)},${weatherLongitude.toFixed(4)}`

  useEffect(() => {
    if (!searchOpen || normalizedSearchQuery.length < 2) {
      searchRequestIdRef.current += 1
      return
    }

    const cacheKey = `${normalizedSearchQuery}|${searchProximityKey}`
    const cached = searchCacheRef.current.get(cacheKey)
    if (cached) {
      setSearchResults(cached)
      setSearchLoading(false)
      setSearchError(null)
      return
    }

    const controller = new AbortController()
    const requestId = searchRequestIdRef.current + 1
    searchRequestIdRef.current = requestId
    const timeout = setTimeout(() => {
      setSearchLoading(true)
      void searchMapResults(normalizedSearchQuery, {
        proximity: searchProximity,
        signal: controller.signal,
      })
        .then((results) => {
          if (requestId !== searchRequestIdRef.current) return
          searchCacheRef.current.set(cacheKey, results)
          setSearchResults(results)
          setSearchError(null)
          setSearchLoading(false)
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          if (requestId !== searchRequestIdRef.current) return
          setSearchResults([])
          setSearchError(error instanceof Error ? error.message : 'Mapbox search failed')
          setSearchLoading(false)
        })
    }, 260)

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [normalizedSearchQuery, searchOpen, searchProximity, searchProximityKey])

  const handleSearchQueryChange = useCallback((query: string) => {
    setSearchQuery(query)
    setSearchResults([])
    setSearchError(null)
    if (query.trim().length < 2) {
      searchRequestIdRef.current += 1
      setSearchResults([])
      setSearchLoading(false)
    }
  }, [])

  const submitSearch = useCallback(async () => {
    if (normalizedSearchQuery.length < 2) return null
    const cacheKey = `${normalizedSearchQuery}|${searchProximityKey}`
    const cached = searchCacheRef.current.get(cacheKey)
    if (cached) return cached[0] ?? null

    const requestId = searchRequestIdRef.current + 1
    searchRequestIdRef.current = requestId
    setSearchLoading(true)
    try {
      const results = await searchMapResults(normalizedSearchQuery, { proximity: searchProximity })
      if (requestId === searchRequestIdRef.current) {
        searchCacheRef.current.set(cacheKey, results)
        setSearchResults(results)
        setSearchError(null)
        setSearchLoading(false)
      }
      return results[0] ?? null
    } catch (error) {
      if (requestId === searchRequestIdRef.current) {
        setSearchResults([])
        setSearchError(error instanceof Error ? error.message : 'Mapbox search failed')
        setSearchLoading(false)
      }
      return null
    }
  }, [normalizedSearchQuery, searchProximity, searchProximityKey])

  const resetSearch = useCallback(() => {
    searchRequestIdRef.current += 1
    setSearchQuery('')
    setSearchResults([])
    setSearchError(null)
    setSearchLoading(false)
  }, [])

  return {
    searchQuery,
    setSearchQuery,
    searchResults,
    searchLoading,
    searchError,
    handleSearchQueryChange,
    submitSearch,
    resetSearch,
  }
}
