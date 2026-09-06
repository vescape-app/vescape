import { ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useState } from 'react'
import { WrenchIcon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { IconHero } from '@/components/settings/IconHero'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ChipRow, ToggleRow, ValueRow } from '@/components/dev/ShowcaseControls'
import { DevBadge } from '@/modules/diagnostics/components/DevBadge'
import { theme } from '@/constants/theme'

function DevBadgeShowcase() {
  return (
    <ShowcaseCard name="DevBadge">
      <Text style={styles.caption}>Tap to expand · long press hides it for a minute</Text>
      {/* The badge stretches to fill its mount point (placement is the overlay's job), so the
          preview gives it a bounded stage tall enough for the expanded menu. */}
      <View style={styles.badgeStage}>
        <DevBadge />
      </View>
    </ShowcaseCard>
  )
}

function ShowcaseControlsShowcase() {
  const [toggle, setToggle] = useState(true)
  const [chip, setChip] = useState('medium')

  return (
    <ShowcaseCard
      name="ShowcaseControls"
      controls={
        <>
          <ToggleRow label="ToggleRow" value={toggle} onToggle={setToggle} />
          <ChipRow
            label="ChipRow"
            options={['small', 'medium', 'large']}
            selected={chip}
            onSelect={setChip}
          />
          <ValueRow label="ValueRow" value={`${chip} · ${toggle ? 'on' : 'off'}`} />
        </>
      }
    >
      <Text style={styles.caption}>
        The controls strip every showcase card uses. Card body above, controls below.
      </Text>
    </ShowcaseCard>
  )
}

export default function DevComponentsPage() {
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={WrenchIcon}
          description="DevBadge, ShowcaseCard, ShowcaseControls — dev-only surfaces and the scaffolding this browser is built from."
        />
        <DevBadgeShowcase />
        <ShowcaseControlsShowcase />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.palette.slate.bg },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
  badgeStage: { height: 260, alignSelf: 'stretch' },
  caption: { color: theme.palette.slate.textPrimary, fontSize: 13, flex: 1 },
})
