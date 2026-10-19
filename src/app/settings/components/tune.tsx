import { Text } from '@/components/base/Text'
import { useState } from 'react'
import { FadersIcon, WavesIcon } from 'phosphor-react-native'
import { TuneProfileSelectCard } from '@/modules/tune/components/TuneProfileSelectCard'
import { tuneProfileColorTheme } from '@/modules/tune/components/TuneProfileMetadataModal'
import { PillSelector, PillSelectorItem } from '@/components/controls/PillSelector'
import { ChipRow } from '@/components/dev/ShowcaseControls'
import { ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ToolboxIcon } from 'phosphor-react-native'

import { IconHero } from '@/components/settings/IconHero'
import { theme } from '@/constants/theme'
import {
  AlertPercentageTuneDialShowcase,
  CompactTuneDialShowcase,
  GeigerAlertTuneDialShowcase,
  TuneDialShowcase,
} from '@/screens/showcase/tune/TuneDialShowcases'
import {
  BasicSliderCellShowcase,
  ManualTuneEditorShowcase,
  TuneProfileMetadataModalShowcase,
  TunePreviewShowcase,
  UnsupportedTunePreviewShowcase,
} from '@/screens/showcase/tune/TunePreviewShowcases'

export default function TunePage() {
  const [selected, setSelected] = useState('Main')
  const [color, setColor] = useState('purple')
  const [tabCount, setTabCount] = useState('2')
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={ToolboxIcon}
          description="TuneDial, BasicSliderCell, Tune Preview, Movement Board Test, TuneSyncBar, TuneGroupGrid."
        />
        <ChipRow
          label="Tune color"
          options={['purple', 'green', 'orange', 'cyan']}
          selected={color}
          onSelect={setColor}
        />
        <ChipRow
          label="Profile count"
          options={['2', '4', '8']}
          selected={tabCount}
          onSelect={setTabCount}
        />
        <Text style={{ color: theme.neutral.textMuted, fontSize: 12 }}>
          Preview · illustrative stats
        </Text>
        <TuneProfileSelectCard
          title
          activeProfile={{
            name: selected,
            icon: selected === 'Flow' ? 'waves' : undefined,
            color: selected === 'Flow' ? 'green' : color,
          }}
          onEdit={() => {}}
          stats={
            selected === 'Flow'
              ? { aggression: 2, turning: 4, atr: 3 }
              : { aggression: 4, turning: 3, atr: 2 }
          }
        >
          <PillSelector
            size="lg"
            activeId={selected}
            contained
            fitContent
            variant="lightTabs"
            style={{ marginHorizontal: 0 }}
          >
            <PillSelectorItem
              id="Main"
              label="Main"
              icon={FadersIcon}
              color={tuneProfileColorTheme(color)}
              onPress={() => setSelected('Main')}
            />
            <PillSelectorItem
              id="Flow"
              label="Flow"
              icon={WavesIcon}
              color={tuneProfileColorTheme('green')}
              onPress={() => setSelected('Flow')}
            />
            {Array.from({ length: Number(tabCount) - 2 }, (_, index) => (
              <PillSelectorItem
                key={index}
                id={`Extra ${index + 1}`}
                label={`Extra ${index + 1}`}
                icon={FadersIcon}
                color={tuneProfileColorTheme(color)}
                onPress={() => setSelected(`Extra ${index + 1}`)}
              />
            ))}
          </PillSelector>
        </TuneProfileSelectCard>
        <TuneProfileSelectCard title activeProfile={null} onEdit={() => {}} />
        <ManualTuneEditorShowcase />
        <TuneDialShowcase />
        <CompactTuneDialShowcase />
        <AlertPercentageTuneDialShowcase />
        <GeigerAlertTuneDialShowcase />
        <BasicSliderCellShowcase />
        <TuneProfileMetadataModalShowcase />
        <TunePreviewShowcase />
        <UnsupportedTunePreviewShowcase />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.neutral.bg },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
})
