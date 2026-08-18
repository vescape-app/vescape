import type { Weather } from 'vescape-core'
import { useMemo } from 'react'
import { CloudSunIcon, MapTrifoldIcon, SpeedometerIcon, type Icon } from 'phosphor-react-native'
import { StyleSheet, View } from 'react-native'

import { Text } from '@/components/base/Text'
import { PillSelector, PillSelectorItem } from '@/components/controls/PillSelector'
import { theme } from '@/constants/theme'
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
function makeWeatherModeIcon(weather: Weather | null, weatherColor: string): Icon {
  return function WeatherModeIcon({ color, size, weight }) {
    const iconSize = typeof size === 'number' ? size : 18
    return weather ? (
      <WeatherIcon icon={weather.icon} size={iconSize} color={weatherColor} weight={weight} />
    ) : (
      <CloudSunIcon size={size} color={color} weight={weight} />
    )
  }
}

export function MapModeTabs({
  mode,
  top,
  onEnterMap,
  onEnterWeather,
  onEnterLegalLimits,
}: MapModeTabsProps) {
  const weather = useWeatherStore((s) => s.weather)
  const weatherColor = weather ? weatherIconColor(weather.icon) : theme.palette.sky.color
  const weatherSelection = {
    bg: theme.alpha(weatherColor, 0.12),
    border: theme.alpha(weatherColor, 0.4),
    color: weatherColor,
  }
  const activeId = mode === 'legalLimits' ? 'legalLimits' : mode === 'weather' ? 'weather' : 'map'

  // Memoised: a fresh component identity every render would remount the pill's icon.
  const WeatherModeIcon = useMemo<Icon>(
    () => makeWeatherModeIcon(weather, weatherColor),
    [weather, weatherColor],
  )

  return (
    <View pointerEvents="box-none" style={[styles.mapModeTabs, { top }]}>
      <PillSelector
        activeId={activeId}
        contained
        fitContent
        style={styles.mapModePills}
        contentContainerStyle={styles.mapModePillsContent}
      >
        <PillSelectorItem
          id="map"
          testID="map-mode-explore"
          label="Explore"
          icon={MapTrifoldIcon}
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
          color={weatherSelection}
          activeWidth={142}
          inactiveWidth={58}
          hint={
            weather ? (
              <Text style={[styles.mapModeBadgeText, { color: weatherColor }]}>
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
