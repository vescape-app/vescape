import { useResolvedSecondaryWidgetSurface } from '@/components/widgets/widgetSurface'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { InfoIcon, PaletteIcon } from 'phosphor-react-native'

import { PillSelector, PillSelectorItem } from '@/components/controls/PillSelector'
import { Text } from '@/components/base/Text'
import { theme } from '@/constants/theme'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import { THEME_OPTIONS } from '@/modules/settings/lib/themeOptions'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'

/** Inline appearance choices in the quick-settings drawer. */
export function ThemePicker() {
  const mode = useSettingsStore((s) => s.themeMode)
  const setSetting = useSettingsStore((s) => s.set)
  const [headerWidth, setHeaderWidth] = useState(0)
  const neutral = useResolvedNeutralColors()
  const surface = useResolvedSecondaryWidgetSurface()
  const selected = THEME_OPTIONS.find((o) => o.mode === mode) ?? THEME_OPTIONS[0]!

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
      <View style={styles.hint}>
        <InfoIcon size={16} color={neutral.textMuted} />
        <Text style={styles.hintText}>{selected.hint}</Text>
      </View>
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
  hint: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hintText: { color: theme.neutral.textMuted, fontSize: 12, flex: 1 },
})
