import { useResolvedSecondaryWidgetSurface } from '@/components/widgets/widgetSurface'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { PaletteIcon } from 'phosphor-react-native'

import { PillSelector, PillSelectorItem } from '@/components/controls/PillSelector'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { formatHour } from '@/helpers/format'
import { THEME_OPTIONS } from '@/modules/settings/lib/themeOptions'
import { useSunThemeClock } from '@/modules/settings/hooks/useSunThemeClock'
import {
  isUsableThemeCoordinate,
  nextSunThemeSwitch,
  type ResolvedTheme,
  type ThemeCoordinate,
} from '@/modules/settings/lib/themeMode'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'

function formatClock(date: Date): string {
  return formatHour(date.getHours() * 60 + date.getMinutes())
}

/** Next light and dark switches of the `sun` mode in time order, empty without a location or switch. */
function upcomingSunSwitches(
  now: Date,
  coordinate: ThemeCoordinate,
): { at: Date; to: ResolvedTheme }[] {
  if (!isUsableThemeCoordinate(coordinate)) return []
  const first = nextSunThemeSwitch(now, coordinate)
  if (!first) return []
  const second = nextSunThemeSwitch(first.at, coordinate)
  return second ? [first, second] : [first]
}

/** Inline appearance choices in the quick-settings drawer. */
export function ThemePicker() {
  const mode = useSettingsStore((s) => s.themeMode)
  const setSetting = useSettingsStore((s) => s.set)
  const [headerWidth, setHeaderWidth] = useState(0)
  const surface = useResolvedSecondaryWidgetSurface()
  const { coordinate, now } = useSunThemeClock()
  const switches = mode === 'sun' ? upcomingSunSwitches(now, coordinate) : []

  return (
    <View style={[styles.card, surface]}>
      <View
        style={styles.topRow}
        onLayout={(event) => setHeaderWidth(event.nativeEvent.layout.width)}
      >
        <View style={styles.heading}>
          <PaletteIcon size={22} color={theme.palette.purple.color} weight="duotone" />
          <Text style={styles.title}>Theme</Text>
        </View>
        <PillSelector
          size="lg"
          activeId={mode}
          contained
          fitContent
          variant="lightTabs"
          style={[styles.tabs, headerWidth > 0 && { maxWidth: headerWidth }]}
        >
          {THEME_OPTIONS.map((option) => (
            <PillSelectorItem
              activeWidth={104}
              inactiveWidth={44}
              key={option.mode}
              id={option.mode}
              label={option.mode === 'sun' ? 'Sun' : option.label}
              icon={option.Icon}
              color={option.hue}
              onPress={() => void setSetting('themeMode', option.mode)}
            />
          ))}
        </PillSelector>
      </View>
      {switches.length > 0 ? (
        <View style={styles.switches}>
          {switches.map(({ at, to }) => {
            const option = THEME_OPTIONS.find((o) => o.mode === to)!
            return (
              <View key={to} style={styles.switch}>
                <option.Icon size={16} color={option.hue.color} weight="duotone" />
                <Text style={styles.hintText}>{option.label} at</Text>
                <Text style={[styles.hintText, styles.hintTime]}>{formatClock(at)}</Text>
              </View>
            )
          })}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 12 },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  topRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: { color: theme.neutral.textPrimary, fontSize: 15, fontWeight: '700' },
  tabs: { maxWidth: '100%' },
  switches: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    columnGap: 16,
    rowGap: 4,
  },
  switch: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hintText: { color: theme.neutral.textMuted, fontSize: 12, textAlign: 'center' },
  hintTime: { color: theme.neutral.textPrimary, fontWeight: '600' },
})
