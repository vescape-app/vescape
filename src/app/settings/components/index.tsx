import { Fragment, useMemo, useState } from 'react'
import { StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, type Href } from 'expo-router'
import {
  ChartLineUpIcon,
  ClockCounterClockwiseIcon,
  CloudMoonIcon,
  CubeIcon,
  CursorClickIcon,
  GearSixIcon,
  LightningIcon,
  ListIcon,
  MapTrifoldIcon,
  MarkdownLogoIcon,
  MegaphoneIcon,
  RowsIcon,
  SlidersHorizontalIcon,
  SquaresFourIcon,
  StackIcon,
  SwatchesIcon,
  TextAaIcon,
  ToolboxIcon,
  UsersThreeIcon,
  WrenchIcon,
  type Icon,
} from 'phosphor-react-native'

import { PageScrollView } from '@/components/base/PageScrollView'
import { Text } from '@/components/base/Text'
import { SearchInput } from '@/components/forms/SearchInput'
import { IconHero } from '@/components/settings/IconHero'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { SettingsSectionTitle } from '@/components/settings/SettingsSectionTitle'
import { theme, type ThemeColor } from '@/constants/theme'
import { AccessoryIcon } from '@/modules/accessories/constants/accessoryIcon'
import {
  SHOWCASE_GROUPS,
  searchShowcase,
  type ShowcaseSectionId,
} from '@/screens/showcase/showcaseCatalog'

const SECTION_VISUALS: Record<ShowcaseSectionId, { icon: Icon; color: ThemeColor }> = {
  theme: { icon: SwatchesIcon, color: theme.palette.violet.color },
  typography: { icon: TextAaIcon, color: theme.neutral.textSecondary },
  base: { icon: CubeIcon, color: theme.palette.cyan.color },
  markdown: { icon: MarkdownLogoIcon, color: theme.palette.teal.color },
  buttons: { icon: CursorClickIcon, color: theme.palette.pink.color },
  controls: { icon: SlidersHorizontalIcon, color: theme.palette.orange.color },
  forms: { icon: ListIcon, color: theme.palette.blue.color },
  modals: { icon: SquaresFourIcon, color: theme.status.upgrade.color },
  drawers: { icon: RowsIcon, color: theme.status.upgrade.color },
  charts: { icon: ChartLineUpIcon, color: theme.palette.green.color },
  widgets: { icon: StackIcon, color: theme.palette.yellow.color },
  settings: { icon: GearSixIcon, color: theme.neutral.textSecondary },
  board: { icon: LightningIcon, color: theme.palette.sky.color },
  accessories: { icon: AccessoryIcon, color: theme.palette.teal.color },
  tune: { icon: ToolboxIcon, color: theme.palette.amber.color },
  history: { icon: ClockCounterClockwiseIcon, color: theme.palette.purple.color },
  map: { icon: MapTrifoldIcon, color: theme.palette.green.light },
  weather: { icon: CloudMoonIcon, color: theme.palette.blue.light },
  social: { icon: UsersThreeIcon, color: theme.palette.groupRide.color },
  notices: { icon: MegaphoneIcon, color: theme.status.warning.color },
  dev: { icon: WrenchIcon, color: theme.palette.amber.color },
}

export default function ComponentsIndex() {
  const [query, setQuery] = useState('')
  const searching = query.trim().length > 0
  const results = useMemo(() => (searching ? searchShowcase(query) : []), [query, searching])

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <PageScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <IconHero
          icon={SwatchesIcon}
          description="Browse and preview all UI components with live controls."
        />
        <SearchInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search components"
          accessibilityLabel="Search components"
          testID="components-search"
          style={styles.search}
        />
        {searching ? (
          results.length > 0 ? (
            <SettingsCard>
              {results.map((hit) => {
                const visual = SECTION_VISUALS[hit.section.id]
                return (
                  <SettingsRow
                    key={hit.id}
                    icon={visual.icon}
                    iconColor={visual.color}
                    label={hit.label}
                    hint={hit.hint}
                    onPress={() =>
                      router.push(
                        hit.focus
                          ? ({
                              pathname: hit.route,
                              params: { focus: hit.focus },
                            } as Href)
                          : (hit.route as Href),
                      )
                    }
                  />
                )
              })}
            </SettingsCard>
          ) : (
            <Text style={styles.noResults}>{`No components match “${query.trim()}”.`}</Text>
          )
        ) : (
          SHOWCASE_GROUPS.map((group) => (
            <Fragment key={group.title}>
              <SettingsSectionTitle>{group.title}</SettingsSectionTitle>
              <SettingsCard>
                {group.sections.map((section) => {
                  const visual = SECTION_VISUALS[section.id]
                  return (
                    <SettingsRow
                      key={section.id}
                      icon={visual.icon}
                      iconColor={visual.color}
                      label={section.label}
                      hint={section.hint}
                      onPress={() => router.push(section.route as Href)}
                    />
                  )
                })}
              </SettingsCard>
            </Fragment>
          ))
        )}
      </PageScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.neutral.bg },
  content: { padding: 16, gap: 8 },
  search: {
    alignSelf: 'center',
    width: '70%',
    marginBottom: 8,
  },
  noResults: {
    color: theme.neutral.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 16,
  },
})
