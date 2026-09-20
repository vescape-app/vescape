import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { CheckIcon, PaletteIcon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { FloatingSheet } from '@/components/overlays/AnchoredSheet'
import { useTriggerRef } from '@/components/overlays/measureTrigger'
import { SelectWidget } from '@/components/widgets/SelectWidget'
import { theme } from '@/constants/theme'
import { THEME_OPTIONS } from '@/modules/settings/lib/themeOptions'
import { useSettingsStore } from '@/modules/settings/store/settingsStore'

/** Settings Drawer row: current theme as a value pill; tapping opens the four theme choices. */
export function ThemePicker() {
  const mode = useSettingsStore((s) => s.themeMode)
  const setSetting = useSettingsStore((s) => s.set)
  const [open, setOpen] = useState(false)
  const triggerRef = useTriggerRef()
  const selected = THEME_OPTIONS.find((o) => o.mode === mode) ?? THEME_OPTIONS[0]!

  return (
    <View>
      <View ref={triggerRef} collapsable={false}>
        <SelectWidget
          icon={PaletteIcon}
          accent={theme.settingsIcon.advanced}
          label="Theme"
          value={selected.label}
          description={selected.hint}
          selectIcon={selected.Icon}
          selectAccent={selected.hue.color}
          selectBackground={selected.hue.bg}
          selectBorder={selected.hue.border}
          selectOpen={open}
          onPress={() => setOpen((o) => !o)}
          onSelectPress={() => setOpen((o) => !o)}
        />
      </View>
      <FloatingSheet
        visible={open}
        triggerRef={triggerRef}
        matchTriggerWidth
        onClose={() => setOpen(false)}
        contentContainerStyle={styles.optionList}
      >
        {THEME_OPTIONS.map((option) => {
          const active = option.mode === mode
          return (
            <Pressable
              key={option.mode}
              style={({ pressed }) => [
                styles.optionRow,
                { backgroundColor: active ? option.hue.bg : 'transparent' },
                pressed && !active && styles.optionRowPressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={option.label}
              onPress={() => {
                void setSetting('themeMode', option.mode)
                setOpen(false)
              }}
            >
              <option.Icon
                size={20}
                color={active ? option.hue.color : theme.neutral.textMuted}
                weight="duotone"
              />
              <View style={styles.optionText}>
                <Text
                  style={[
                    styles.optionLabel,
                    { color: active ? option.hue.color : theme.neutral.textPrimary },
                  ]}
                >
                  {option.label}
                </Text>
                <Text style={styles.optionHint} numberOfLines={1}>
                  {option.hint}
                </Text>
              </View>
              {active ? <CheckIcon size={17} color={option.hue.color} weight="bold" /> : null}
            </Pressable>
          )
        })}
      </FloatingSheet>
    </View>
  )
}

const styles = StyleSheet.create({
  optionList: {
    gap: 6,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
  },
  optionRowPressed: {
    backgroundColor: theme.neutral.surface,
  },
  optionText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  optionLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
  optionHint: {
    color: theme.neutral.textSecondary,
    fontSize: 11,
  },
})
