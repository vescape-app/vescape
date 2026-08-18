import { StyleSheet, View } from 'react-native'
import { Text } from '@/components/base/Text'
import { useState } from 'react'
import {
  BriefcaseIcon,
  CameraIcon,
  CloudSunIcon,
  FadersIcon,
  GaugeIcon,
  HeartIcon,
  HouseIcon,
  LightningIcon,
  MapPinIcon,
  MapTrifoldIcon,
  NavigationArrowIcon,
  PencilSimpleIcon,
  SpeedometerIcon,
  SlidersHorizontalIcon,
  TrashIcon,
  WrenchIcon,
} from 'phosphor-react-native'

import {
  PillSelectorItem,
  PillSelectorAdd,
  PillSelectorDot,
  PillSelectorMenuItem,
  PillSelector,
} from '@/components/controls/PillSelector'

import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { theme } from '@/constants/theme'

export function ZonePillsShowcase() {
  const [selectedId, setSelectedId] = useState('home')
  const [wideSelectedId, setWideSelectedId] = useState('trail')
  const [regularScrollId, setRegularScrollId] = useState('home')
  const [tunePresetId, setTunePresetId] = useState('street')
  const [mapModeId, setMapModeId] = useState('legalLimits')
  const iconOptions = [
    { id: 'trail', label: 'Trail', icon: MapPinIcon, color: theme.palette.violet },
    { id: 'street', label: 'Street', icon: NavigationArrowIcon, color: theme.palette.sky },
    { id: 'boost', label: 'Boost', icon: LightningIcon, color: theme.palette.amber },
    { id: 'camera', label: 'Camera', icon: CameraIcon, color: theme.palette.purple },
    { id: 'favorites', label: 'Favorites', icon: HeartIcon, color: theme.palette.red },
  ]
  const regularScrollOptions = [
    { id: 'home', label: 'Home', icon: HouseIcon, color: theme.palette.green },
    { id: 'work', label: 'Work', icon: BriefcaseIcon, color: theme.palette.sky },
    { id: 'gym', label: 'Gym', icon: LightningIcon, color: theme.palette.amber },
    { id: 'parents', label: 'Parents', icon: HeartIcon, color: theme.palette.red },
    { id: 'garage', label: 'Garage', icon: WrenchIcon, color: theme.palette.orange },
    { id: 'trailhead', label: 'Trailhead', icon: MapPinIcon, color: theme.palette.violet },
  ]
  const tunePresetOptions = [
    { id: 'street', label: 'Street', icon: SlidersHorizontalIcon, color: theme.palette.sky },
    { id: 'trail', label: 'Trail', icon: MapPinIcon, color: theme.palette.violet },
    { id: 'race', label: 'Race', icon: GaugeIcon, color: theme.palette.red },
    { id: 'commute', label: 'Commute', icon: BriefcaseIcon, color: theme.palette.green },
    { id: 'flow', label: 'Flow', icon: FadersIcon, color: theme.palette.purple },
    { id: 'torque', label: 'Torque', icon: LightningIcon, color: theme.palette.amber },
  ]
  const renderIconOptions = (includeAdd = false) => (
    <PillSelector activeId={wideSelectedId}>
      {iconOptions.map((option) => (
        <PillSelectorItem
          key={option.id}
          id={option.id}
          label={option.label}
          icon={option.icon}
          color={option.color}
          onPress={() => setWideSelectedId(option.id)}
        />
      ))}
      {includeAdd ? <PillSelectorAdd onPress={() => undefined} /> : null}
    </PillSelector>
  )

  return (
    <ShowcaseCard name="PillSelector">
      <View style={styles.selectorVariants}>
        <View style={styles.selectorVariant}>
          <Text style={styles.selectorCaption}>
            icons, status dots, add button, long-press menu
          </Text>
          <PillSelector activeId={selectedId}>
            <PillSelectorItem
              id="home"
              label="Home"
              icon={HouseIcon}
              labelBehavior="always"
              badge={<PillSelectorDot status="enabled" />}
              color={theme.palette.green}
              onPress={() => setSelectedId('home')}
            >
              <PillSelectorMenuItem
                icon={TrashIcon}
                label="Delete"
                onPress={() => undefined}
                danger
              />
            </PillSelectorItem>
            <PillSelectorItem
              id="work"
              label="Work"
              icon={BriefcaseIcon}
              labelBehavior="always"
              badge={<PillSelectorDot status="disabled" />}
              color={theme.palette.green}
              onPress={() => setSelectedId('work')}
            >
              <PillSelectorMenuItem
                icon={TrashIcon}
                label="Delete"
                onPress={() => undefined}
                danger
              />
            </PillSelectorItem>
            <PillSelectorItem
              id="custom"
              label="Custom"
              labelBehavior="always"
              badge={<PillSelectorDot status="draft" />}
              color={theme.palette.green}
              onPress={() => setSelectedId('custom')}
            >
              <PillSelectorMenuItem
                icon={PencilSimpleIcon}
                label="Rename"
                onPress={() => undefined}
              />
              <PillSelectorMenuItem
                icon={TrashIcon}
                label="Delete"
                onPress={() => undefined}
                danger
                separator
              />
            </PillSelectorItem>
            <PillSelectorAdd onPress={() => undefined} />
          </PillSelector>
        </View>

        <View style={styles.selectorVariant}>
          <Text style={styles.selectorCaption}>mixed active colors and icon-only differences</Text>
          {renderIconOptions()}
        </View>

        <View style={styles.selectorVariant}>
          <Text style={styles.selectorCaption}>constrained width, horizontal scroll</Text>
          <View style={styles.narrowPreview}>{renderIconOptions(true)}</View>
        </View>

        <View style={styles.selectorVariant}>
          <Text style={styles.selectorCaption}>regular labels, six items, horizontal scroll</Text>
          <View style={styles.narrowPreviewWide}>
            <PillSelector activeId={regularScrollId}>
              {regularScrollOptions.map((option) => (
                <PillSelectorItem
                  key={option.id}
                  id={option.id}
                  label={option.label}
                  icon={option.icon}
                  labelBehavior="always"
                  color={option.color}
                  onPress={() => setRegularScrollId(option.id)}
                />
              ))}
              <PillSelectorAdd onPress={() => undefined} />
            </PillSelector>
          </View>
        </View>

        <View style={styles.selectorVariant}>
          <Text style={styles.selectorCaption}>
            tune presets, default collapsing labels, add button
          </Text>
          <View style={styles.narrowPreviewWide}>
            <PillSelector activeId={tunePresetId} contained>
              {tunePresetOptions.map((option) => (
                <PillSelectorItem
                  key={option.id}
                  id={option.id}
                  label={option.label}
                  icon={option.icon}
                  color={option.color}
                  activeWidth={118}
                  onPress={() => setTunePresetId(option.id)}
                />
              ))}
              <PillSelectorAdd onPress={() => undefined} />
            </PillSelector>
          </View>
        </View>

        <View style={styles.selectorVariant}>
          <Text style={styles.selectorCaption}>map mode tabs, active label only</Text>
          <PillSelector activeId={mapModeId} contained fitContent style={styles.mapModeTabsPreview}>
            <PillSelectorItem
              id="map"
              label="Explore"
              icon={MapTrifoldIcon}
              color={theme.palette.violet}
              activeWidth={116}
              onPress={() => setMapModeId('map')}
            />
            <PillSelectorItem
              id="weather"
              label="Weather"
              icon={CloudSunIcon}
              color={theme.palette.sky}
              activeWidth={142}
              inactiveWidth={58}
              hint={<Text style={styles.mapModeHint}>23°</Text>}
              hintVisibility="inactive"
              hintGap={2}
              onPress={() => setMapModeId('weather')}
            />
            <PillSelectorItem
              id="legalLimits"
              label="Legal limits"
              icon={SpeedometerIcon}
              color={theme.palette.green}
              activeWidth={136}
              inactiveWidth={44}
              onPress={() => setMapModeId('legalLimits')}
            />
          </PillSelector>
        </View>
      </View>
    </ShowcaseCard>
  )
}

const styles = StyleSheet.create({
  selectorVariants: {
    gap: 18,
    paddingVertical: 8,
  },
  selectorVariant: {
    gap: 8,
  },
  selectorCaption: {
    color: theme.palette.slate.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  narrowPreview: {
    width: 220,
    alignSelf: 'center',
    overflow: 'hidden',
    paddingVertical: 10,
  },
  narrowPreviewWide: {
    width: 260,
    alignSelf: 'center',
    overflow: 'hidden',
    paddingVertical: 10,
  },
  mapModeTabsPreview: {
    alignSelf: 'center',
  },
  mapModeHint: {
    color: theme.palette.sky.color,
    fontSize: 11,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
})
