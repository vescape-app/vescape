import { CloudSunIcon, MapTrifoldIcon, SpeedometerIcon, type Icon } from 'phosphor-react-native'
import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { PillSelector, PillSelectorItem } from '@/components/controls/PillSelector'
import { theme } from '@/constants/theme'
import { useThemeStore } from '@/hooks/useTheme'
import { WeatherIcon } from '@/modules/weather/components/WeatherIcon'
import { weatherIconColor } from '@/modules/weather/lib/weather'
import { useWeatherStore } from '@/modules/weather/store/weatherStore'
import type { MainViewState } from '@/screens/main/mainViewState'

interface MapModeTabsProps {
  mode: MainViewState
  top: number
  onEnterMap: () => void
  onEnterWeather: () => void
  onEnterLegalLimits: () => void
}

/** The three map modes the rider switches between: Explore, Weather and Legal limits. */
export function MapModeTabs({
  mode,
  top,
  onEnterMap,
  onEnterWeather,
  onEnterLegalLimits,
}: MapModeTabsProps) {
  const weather = useWeatherStore((s) => s.weather)
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
  const light = resolvedTheme === 'light'
  const weatherColor = weather ? weatherIconColor(weather.icon) : theme.palette.sky.color
  // In light mode the inactive weather segment should read neutral (white on the navy track),
  // not colored — match the other map-mode tabs. The active segment keeps the weather hue.
  const inactiveWeatherColor = light ? theme.palette.mono.white : weatherColor
  const weatherSelection = {
    bg: theme.alpha(weatherColor, 0.12),
    border: theme.alpha(weatherColor, 0.4),
    color: weatherColor,
  }
  const activeId = mode === 'legalLimits' ? 'legalLimits' : mode === 'weather' ? 'weather' : 'map'

  const WeatherModeIcon: Icon = ({ color, size, weight }) => {
    const iconSize = typeof size === 'number' ? size : 18
    // PillSelectorItem passes the inactive accent as `color` when this segment is not selected;
    // honor it so the icon turns neutral in light mode and keeps the weather hue when active.
    const iconColor = color ?? weatherColor
    return weather ? (
      <WeatherIcon icon={weather.icon} size={iconSize} color={iconColor} weight={weight} />
    ) : (
      <CloudSunIcon size={size} color={iconColor} weight={weight} />
    )
  }

  return (
    <View pointerEvents="box-none" style={[styles.mapModeTabs, { top }]}>
      <PillSelector
        activeId={activeId}
        contained
        fitContent
        variant="lightTabs"
        style={styles.mapModePills}
        contentContainerStyle={styles.mapModePillsContent}
      >
        <PillSelectorItem
          id="map"
          testID="map-mode-explore"
          label="Explore"
          icon={MapTrifoldIcon}
          activeLabelOnly
          color={theme.palette.violet}
          activeWidth={116}
          onPress={() => {
            if (mode !== 'map') onEnterMap()
          }}
        />
        <PillSelectorItem
          id="weather"
          testID="map-mode-weather"
          label="Weather"
          icon={WeatherModeIcon}
          activeLabelOnly
          color={weatherSelection}
          activeWidth={142}
          inactiveWidth={58}
          hint={
            weather ? (
              <Text style={[styles.mapModeBadgeText, { color: inactiveWeatherColor }]}>
                {weather.temperatureC}°
              </Text>
            ) : null
          }
          hintVisibility="inactive"
          hintGap={2}
          onPress={onEnterWeather}
        />
        <PillSelectorItem
          id="legalLimits"
          testID="map-mode-legal-limits"
          label="Legal limits"
          icon={SpeedometerIcon}
          activeLabelOnly
          color={theme.palette.green}
          activeWidth={136}
          inactiveWidth={44}
          onPress={onEnterLegalLimits}
        />
      </PillSelector>
    </View>
  )
}

const styles = StyleSheet.create({
  mapModeTabs: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 43,
  },
  mapModePills: {
    alignSelf: 'center',
  },
  mapModePillsContent: {
    justifyContent: 'center',
  },
  mapModeBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
})
