import { CaretDownIcon, CaretUpIcon, ArrowLeftIcon } from 'phosphor-react-native'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { IconButton } from '@/components/base/IconButton'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { LegalLimitCountrySheet } from '@/modules/legal/components/LegalLimitCountrySheet'
import {
  LEGAL_LIMIT_COUNTRIES,
  LEGAL_ROAD_STATUS_COLORS,
  LEGAL_ROAD_STATUS_LABELS,
  LEGAL_ROAD_STATUS_LEGEND,
  type LegalLimitCountry,
} from '@/modules/legal/lib/legalLimits'

const LIST_PANEL_HEIGHT = 280
const OVERLAY_GAP = 8
const LEGEND_HEIGHT = 12
const LIST_TOGGLE_HEIGHT = 42

interface LegalLimitsMapOverlayProps {
  visible: boolean
  /** Top of the map's control row, so the back button lines up with the mode tabs. */
  top: number
  onExit: () => void
}

/** Legal limits mode: the road status legend, the country list and the per-country sheet. */
export function LegalLimitsMapOverlay({ visible, top, onExit }: LegalLimitsMapOverlayProps) {
  const insets = useSafeAreaInsets()
  const [listOpen, setListOpen] = useState(false)
  const [selectedCountry, setSelectedCountry] = useState<LegalLimitCountry | null>(null)

  // Leaving the mode drops the selection, so returning to it starts from the map rather than from
  // whatever country was last read.
  useEffect(() => {
    if (visible) return
    const frame = requestAnimationFrame(() => {
      setListOpen(false)
      setSelectedCountry(null)
    })
    return () => cancelAnimationFrame(frame)
  }, [visible])

  const listVisible = visible && listOpen
  const baseBottom = listVisible ? LIST_PANEL_HEIGHT : Math.max(insets.bottom, 16)
  const legendBottom = baseBottom + OVERLAY_GAP
  const listToggleBottom = legendBottom + LEGEND_HEIGHT + OVERLAY_GAP

  return (
    <View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[styles.legalLimitsInterface, visible ? styles.visible : styles.hidden]}
    >
      <IconButton
        icon={ArrowLeftIcon}
        size="sm"
        testID="legal-limits-exit"
        accessibilityLabel="Exit legal limits"
        onPress={onExit}
        style={[styles.mapTopBackButton, { top }]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={listVisible ? 'Hide legal limits list' : 'Show legal limits list'}
        onPress={() => setListOpen((open) => !open)}
        style={({ pressed }) => [
          styles.legalListToggle,
          { bottom: listToggleBottom },
          pressed && styles.legalListTogglePressed,
        ]}
      >
        {listVisible ? (
          <CaretDownIcon size={18} color={theme.neutral.textSecondary} weight="bold" />
        ) : (
          <CaretUpIcon size={18} color={theme.neutral.textSecondary} weight="bold" />
        )}
        <Text style={styles.legalListToggleLabel}>{listVisible ? 'HIDE LIST' : 'SHOW LIST'}</Text>
      </Pressable>
      <View pointerEvents="none" style={[styles.legalLegend, { bottom: legendBottom }]}>
        {LEGAL_ROAD_STATUS_LEGEND.map((status) => (
          <View key={status} style={styles.legalLegendItem}>
            <View
              style={[styles.legalLegendDot, { backgroundColor: LEGAL_ROAD_STATUS_COLORS[status] }]}
            />
            <Text style={styles.legalLegendText}>{LEGAL_ROAD_STATUS_LABELS[status]}</Text>
          </View>
        ))}
      </View>
      {listVisible ? (
        <View style={[styles.legalListPanel, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.legalListContent}
          >
            {LEGAL_LIMIT_COUNTRIES.map((country) => (
              <Pressable
                key={country.code}
                accessibilityRole="button"
                accessibilityLabel={`${country.name} legal limits`}
                style={({ pressed }) => [
                  styles.legalCountryRow,
                  pressed && styles.legalCountryRowPressed,
                ]}
                onPress={() => setSelectedCountry(country)}
              >
                <View
                  style={[
                    styles.legalCountryDot,
                    { backgroundColor: LEGAL_ROAD_STATUS_COLORS[country.status] },
                  ]}
                />
                <Text style={styles.legalCountryName} numberOfLines={1}>
                  {country.name}
                </Text>
                <Text style={styles.legalCountryStatus} numberOfLines={1}>
                  {LEGAL_ROAD_STATUS_LABELS[country.status]}
                </Text>
                <Text style={styles.legalCountrySpeed}>
                  {country.referenceSpeedKmh == null ? 'N/A' : `${country.referenceSpeedKmh} km/h`}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
      <LegalLimitCountrySheet
        country={visible ? selectedCountry : null}
        onClose={() => setSelectedCountry(null)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  legalLimitsInterface: {
    ...StyleSheet.absoluteFill,
    zIndex: 9,
  },
  visible: {
    opacity: 1,
  },
  hidden: {
    opacity: 0,
  },
  mapTopBackButton: {
    position: 'absolute',
    left: 12,
    zIndex: 32,
    borderColor: theme.control.border,
    backgroundColor: theme.alpha(theme.control.background, 0.85),
  },
  legalLegend: {
    position: 'absolute',
    left: 54,
    right: 54,
    zIndex: 28,
    flexDirection: 'row',
    flexWrap: 'nowrap',
    justifyContent: 'center',
    gap: 8,
  },
  legalLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legalLegendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legalLegendText: {
    color: theme.neutral.textPrimary,
    fontSize: 9,
    fontWeight: '800',
    textShadowColor: theme.alpha(theme.neutral.surfaceDeep, 0.6),
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  legalListToggle: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: LIST_TOGGLE_HEIGHT,
    paddingHorizontal: 16,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    backgroundColor: theme.alpha(theme.neutral.surfaceDeep, 0.85),
    zIndex: 31,
  },
  legalListTogglePressed: {
    backgroundColor: theme.neutral.surface,
  },
  legalListToggleLabel: {
    color: theme.neutral.textSecondary,
    fontSize: 11,
    fontWeight: '900',
  },
  legalListPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: LIST_PANEL_HEIGHT,
    paddingTop: 14,
    paddingHorizontal: 14,
    gap: 8,
    backgroundColor: theme.alpha(theme.neutral.surfaceDeep, 0.85),
    borderTopWidth: 1,
    borderTopColor: theme.neutral.border,
    zIndex: 30,
  },
  legalListContent: {
    gap: 8,
  },
  legalCountryRow: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 8,
    paddingHorizontal: 2,
  },
  legalCountryRowPressed: {
    backgroundColor: theme.alpha(theme.palette.slate.light, 0.12),
  },
  legalCountryDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  legalCountryName: {
    flex: 1.1,
    color: theme.neutral.textPrimary,
    fontSize: 12,
    fontWeight: '800',
  },
  legalCountryStatus: {
    flex: 0.9,
    color: theme.neutral.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  legalCountrySpeed: {
    width: 56,
    color: theme.neutral.textPrimary,
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'right',
  },
})
