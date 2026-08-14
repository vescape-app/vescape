import { Fragment } from 'react'
import { ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import {
  ChartLineUpIcon,
  ListIcon,
  MapTrifoldIcon,
  SwatchesIcon,
  ToolboxIcon,
  CloudMoonIcon,
  CubeIcon,
  GearSixIcon,
  LightningIcon,
  MarkdownLogoIcon,
  SquaresFourIcon,
  StackIcon,
  TextAaIcon,
} from 'phosphor-react-native'

import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { SettingsSectionTitle } from '@/components/settings/SettingsSectionTitle'
import { IconHero } from '@/components/settings/IconHero'
import { theme } from '@/constants/theme'

const groups = [
  {
    title: 'Foundations',
    sections: [
      {
        label: 'Base',
        hint: 'Buttons, banners, placeholders, and other everyday building blocks',
        route: '/settings/components/base',
        icon: CubeIcon,
        color: theme.palette.cyan.color,
      },
      {
        label: 'Typography',
        hint: 'Raleway across every UI text role, with weight and tabular-nums parity',
        route: '/settings/components/typography',
        icon: TextAaIcon,
        color: theme.palette.slate.textSecondary,
      },
      {
        label: 'Markdown',
        hint: 'Native rich text — nesting, links, images, and horizontally scrolling tables',
        route: '/settings/components/markdown',
        icon: MarkdownLogoIcon,
        color: theme.palette.teal.color,
      },
    ],
  },
  {
    title: 'General use',
    sections: [
      {
        label: 'Charts',
        hint: 'Sparklines and gauges for showing telemetry over time',
        route: '/settings/components/charts',
        icon: ChartLineUpIcon,
        color: theme.palette.green.color,
      },
      {
        label: 'Forms',
        hint: 'Inputs, dropdowns, pickers, and steppers for entering data',
        route: '/settings/components/forms',
        icon: ListIcon,
        color: theme.palette.blue.color,
      },
      {
        label: 'Modals',
        hint: 'Popups, confirmations, and sheets that float above the screen',
        route: '/settings/components/modals',
        icon: SquaresFourIcon,
        color: theme.status.upgrade.color,
      },
      {
        label: 'Controls',
        hint: 'Buttons and selectors for switching between options or views',
        route: '/settings/components/controls',
        icon: SwatchesIcon,
        color: theme.palette.orange.color,
      },
      {
        label: 'Settings',
        hint: 'Cards and rows used to build settings screens',
        route: '/settings/components/settings',
        icon: GearSixIcon,
        color: theme.palette.slate.light,
      },
    ],
  },
  {
    title: 'Domain',
    sections: [
      {
        label: 'Board',
        hint: 'Device rows, badges, link timelines, and warnings tied to the board domain',
        route: '/settings/components/board',
        icon: LightningIcon,
        color: theme.palette.sky.color,
      },
      {
        label: 'Widgets',
        hint: 'Dashboard tiles for showing and editing live board data',
        route: '/settings/components/widgets',
        icon: StackIcon,
        color: theme.palette.yellow.color,
      },
      {
        label: 'Tune',
        hint: 'Dials, sliders, and grids for adjusting board tuning',
        route: '/settings/components/tune',
        icon: ToolboxIcon,
        color: theme.palette.amber.color,
      },
      {
        label: 'Weather',
        hint: 'Icons and strips for showing weather conditions and forecasts',
        route: '/settings/components/weather',
        icon: CloudMoonIcon,
        color: theme.palette.blue.light,
      },
      {
        label: 'Stack lab',
        hint: 'Chart-stack reveal in the abstract — modes, slow motion, and a ruler to measure it',
        route: '/settings/components/stack-lab',
        icon: StackIcon,
        color: theme.palette.red.color,
      },
      {
        label: 'Map',
        hint: 'Map pins, routes, riders, weather radar, buildings — all layers, live controls',
        route: '/settings/components/map',
        icon: MapTrifoldIcon,
        color: theme.palette.green.light,
      },
    ],
  },
]

export default function ComponentsIndex() {
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={SwatchesIcon}
          description="Browse and preview all UI components with live controls."
        />
        {groups.map((group) => (
          <Fragment key={group.title}>
            <SettingsSectionTitle>{group.title}</SettingsSectionTitle>
            <SettingsCard>
              {group.sections.map((s) => (
                <SettingsRow
                  key={s.label}
                  icon={s.icon}
                  iconColor={s.color}
                  label={s.label}
                  hint={s.hint}
                  onPress={() => router.push(s.route as any)}
                />
              ))}
            </SettingsCard>
          </Fragment>
        ))}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.palette.slate.bg },
  content: { padding: 16, gap: 8 },
})
