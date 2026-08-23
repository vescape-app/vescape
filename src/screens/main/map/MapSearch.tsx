import { MagnifyingGlassIcon, XIcon } from 'phosphor-react-native'
import { useCallback } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native'

import { IconButton } from '@/components/base/IconButton'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import { useMapSearch } from '@/modules/map/hooks/useMapSearch'
import type { MapSearchResult } from '@/modules/map/lib/search'
import { getPlaceCategoryIcon } from '@/modules/map-points/constants/mapPointIcons'
import { MapVignette } from '@/screens/main/map/MapVignette'

function MapSearchResultIcon({ category }: { category: string | null }) {
  const IconComponent = getPlaceCategoryIcon(category)
  return <IconComponent size={16} color={theme.palette.green.text} weight="duotone" />
}

function MapSearchSheet({
  top,
  searchProximity,
  onClose,
  onSelectResult,
}: {
  top: number
  searchProximity: { latitude: number; longitude: number } | null
  onClose: () => void
  onSelectResult: (result: MapSearchResult) => void
}) {
  const neutral = useResolvedNeutralColors()
  const {
    searchQuery,
    searchResults,
    searchLoading,
    searchError,
    handleSearchQueryChange,
    submitSearch,
  } = useMapSearch({ searchOpen: true, proximityLocation: searchProximity })

  const handleSubmit = useCallback(async () => {
    const first = searchResults[0]
    if (first) {
      onSelectResult(first)
      return
    }
    const submittedResult = await submitSearch()
    if (submittedResult) onSelectResult(submittedResult)
  }, [onSelectResult, searchResults, submitSearch])

  const showNoResults =
    !searchLoading && !searchError && searchQuery.trim().length >= 2 && searchResults.length === 0
  const showResultPanel =
    searchLoading || searchError != null || showNoResults || searchResults.length > 0

  return (
    <>
      <MapVignette mode="map" idPrefix="search-map-vignette" topOnly />
      <View style={[styles.sheet, { top }]}>
        <View
          style={[
            styles.bar,
            {
              backgroundColor: theme.alpha(neutral.surfaceDeep, 0.85),
              borderColor: theme.alpha(neutral.textSecondary, 0.3),
            },
          ]}
        >
          <MagnifyingGlassIcon size={22} color={neutral.textSecondary} weight="bold" />
          <TextInput
            autoFocus
            selectTextOnFocus
            value={searchQuery}
            onChangeText={handleSearchQueryChange}
            onSubmitEditing={() => void handleSubmit()}
            placeholder="Address or place"
            placeholderTextColor={neutral.textMuted}
            returnKeyType="search"
            style={[styles.input, { color: neutral.textPrimary }]}
          />
          <Pressable
            accessibilityLabel="Close search"
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [styles.close, pressed && styles.pressed]}
          >
            <XIcon size={22} color={neutral.textSecondary} weight="bold" />
          </Pressable>
        </View>
        {showResultPanel ? (
          <View
            style={[
              styles.results,
              {
                backgroundColor: theme.alpha(neutral.surfaceDeep, 0.85),
                borderColor: theme.alpha(neutral.textSecondary, 0.3),
              },
            ]}
          >
            {searchLoading ? (
              <View style={styles.statusRow}>
                <ActivityIndicator size="small" color={theme.palette.sky.color} />
                <Text style={styles.statusText}>Searching Mapbox</Text>
              </View>
            ) : null}
            {searchError ? (
              <View style={styles.statusRow}>
                <Text style={styles.errorText}>{searchError}</Text>
              </View>
            ) : null}
            {showNoResults ? (
              <View style={styles.statusRow}>
                <Text style={styles.statusText}>No results</Text>
              </View>
            ) : null}
            {searchResults.map((result, index) => (
              <Pressable
                key={result.id}
                accessibilityRole="button"
                style={({ pressed }) => [styles.result, pressed && styles.pressed]}
                onPress={() => onSelectResult(result)}
              >
                <View style={[styles.resultIcon, { backgroundColor: neutral.surfaceDeep }]}>
                  <MapSearchResultIcon category={result.category} />
                </View>
                <View style={styles.resultText}>
                  <Text style={styles.resultTitle} numberOfLines={1}>
                    {result.title}
                  </Text>
                  <Text style={styles.resultSubtitle} numberOfLines={1}>
                    {result.subtitle}
                  </Text>
                </View>
                {index < searchResults.length - 1 ? (
                  <View
                    style={[
                      styles.resultBorder,
                      { backgroundColor: theme.alpha(neutral.textSecondary, 0.3) },
                    ]}
                  />
                ) : null}
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    </>
  )
}

/** Place search: a button until it is opened, then a sheet over the top of the map. */
export function MapSearch({
  open,
  top,
  searchProximity,
  onOpen,
  onClose,
  onSelectResult,
}: {
  open: boolean
  top: number
  searchProximity: { latitude: number; longitude: number } | null
  onOpen: () => void
  onClose: () => void
  onSelectResult: (result: MapSearchResult) => void
}) {
  if (!open) {
    return (
      <IconButton
        icon={MagnifyingGlassIcon}
        size="sm"
        onPress={onOpen}
        style={[styles.button, { top }]}
      />
    )
  }
  return (
    <MapSearchSheet
      top={top}
      searchProximity={searchProximity}
      onClose={onClose}
      onSelectResult={onSelectResult}
    />
  )
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    right: 12,
    zIndex: 44,
  },
  sheet: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 44,
    gap: 8,
  },
  bar: {
    height: 50,
    borderRadius: 25,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 14,
    paddingRight: 0,
  },
  input: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: '700',
    paddingVertical: 10,
  },
  close: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.55,
  },
  results: {
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
  },
  statusRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
  },
  statusText: {
    color: theme.neutral.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  errorText: {
    color: theme.status.error.text,
    fontSize: 12,
    fontWeight: '700',
  },
  result: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 8,
    paddingRight: 14,
    position: 'relative',
  },
  resultIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: theme.palette.green.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultText: {
    flex: 1,
    minWidth: 0,
  },
  resultTitle: {
    color: theme.neutral.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  resultSubtitle: {
    color: theme.neutral.textMuted,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  resultBorder: {
    position: 'absolute',
    left: 54,
    right: 0,
    bottom: 0,
    height: 1,
  },
})
