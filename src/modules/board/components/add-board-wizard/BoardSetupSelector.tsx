import { useRef, useState } from 'react'
import { Pressable, StyleSheet, TextInput, View } from 'react-native'
import { ArrowLeftIcon, CaretRightIcon, CheckIcon, SquaresFourIcon } from 'phosphor-react-native'

import { Text } from '@/components/base/Text'
import { EdgeDrawer } from '@/components/overlays/EdgeDrawer'
import { font, theme } from '@/constants/theme'
import { useResolvedNeutralColors } from '@/hooks/useTheme'
import { BoardModelPreview } from '@/modules/board/components/BoardModelPreview'
import { CustomRailPickerContent } from '@/modules/board/components/CustomRailPickerContent'
import { AnimatedBoardPreview } from '@/modules/board/components/add-board-wizard/AnimatedBoardPreview'
import { BoardColorPicker } from '@/modules/board/components/add-board-wizard/BoardColorPicker'
import type { UseAddBoardWizard } from '@/modules/board/hooks/useAddBoardWizard'
import {
  BOARD_PRESET_BRANDS,
  BOARD_PRESETS,
  CUSTOM_RAIL_OPTIONS,
  getBoardPreset,
  getCustomRailOption,
  type BoardPresetBrand,
  type RailBrand,
} from '@/modules/board/lib/boardPresets'

export function BoardSetupSelector({ wizard }: { wizard: UseAddBoardWizard }) {
  const neutral = useResolvedNeutralColors()
  const [sheet, setSheet] = useState<'presets' | 'rails' | null>(null)
  const [presetBrand, setPresetBrand] = useState<BoardPresetBrand | null>(null)
  const [railBrand, setRailBrand] = useState<RailBrand | null>(null)
  const [nameFocused, setNameFocused] = useState(false)
  const [nameWidth, setNameWidth] = useState(0)
  const [lineWidth, setLineWidth] = useState(0)
  const nameInputRef = useRef<TextInput>(null)
  const presetTriggerRef = useRef<View>(null)
  const railTriggerRef = useRef<View>(null)
  const selectedPreset = getBoardPreset(wizard.boardPresetId)
  const selectedRail = getCustomRailOption(wizard.customRailOptionId)

  const openRails = () => {
    wizard.enterCustomBuild()
    setRailBrand(null)
    setSheet('rails')
  }
  const openPresets = () => {
    setPresetBrand(null)
    setSheet('presets')
  }

  return (
    <View style={styles.root}>
      <View style={styles.preview}>
        <AnimatedBoardPreview railId={wizard.railId} railColorId={wizard.railColorId} size={230} />
      </View>

      <Pressable
        style={[styles.nameLine, { borderBottomColor: neutral.border }]}
        onLayout={(event) => setLineWidth(event.nativeEvent.layout.width)}
        onPress={() => nameInputRef.current?.focus()}
      >
        <Text
          style={styles.nameMeasure}
          onLayout={(event) => setNameWidth(event.nativeEvent.layout.width)}
          pointerEvents="none"
        >
          {wizard.name || ' '}
        </Text>
        <TextInput
          ref={nameInputRef}
          value={wizard.name}
          onChangeText={wizard.setName}
          onFocus={() => setNameFocused(true)}
          onBlur={() => setNameFocused(false)}
          selectionColor={theme.palette.cyan.color}
          returnKeyType="done"
          accessibilityLabel="Name your board"
          testID="add-board-name-input"
          style={[
            styles.nameInput,
            {
              width: Math.min(lineWidth || 32, Math.max(32, nameWidth + 24)),
              color: neutral.textPrimary,
            },
          ]}
        />
        {!wizard.name && !nameFocused ? (
          <Text style={styles.namePlaceholder} pointerEvents="none">
            Name your board
          </Text>
        ) : null}
      </Pressable>

      <BoardColorPicker
        railColorId={wizard.railColorId}
        onRailColorChange={wizard.setRailColorId}
      />

      <View style={styles.choiceRow}>
        <View ref={railTriggerRef} collapsable={false} style={styles.choiceWrap}>
          <Pressable
            onPress={openRails}
            accessibilityRole="button"
            accessibilityLabel={
              selectedRail ? `Custom build, ${selectedRail.name}` : 'Custom build'
            }
            style={[styles.choice, selectedRail && styles.choiceSelected]}
          >
            {selectedRail ? <Text style={styles.choiceEyebrow}>Custom build</Text> : null}
            <View style={styles.choiceValueRow}>
              <Text
                style={[styles.choiceValue, selectedRail && styles.choiceValueSelected]}
                numberOfLines={2}
              >
                {selectedRail?.name ?? 'Custom build'}
              </Text>
              <CaretRightIcon size={15} color={theme.neutral.textMuted} />
            </View>
          </Pressable>
        </View>
        <View ref={presetTriggerRef} collapsable={false} style={styles.choiceWrap}>
          <Pressable
            onPress={openPresets}
            accessibilityRole="button"
            accessibilityLabel={
              selectedPreset ? `Board presets, ${selectedPreset.name}` : 'Board presets'
            }
            style={[styles.choice, selectedPreset && styles.choiceSelected]}
          >
            {selectedPreset ? <Text style={styles.choiceEyebrow}>Board preset</Text> : null}
            <View style={styles.choiceValueRow}>
              <Text
                style={[styles.choiceValue, selectedPreset && styles.choiceValueSelected]}
                numberOfLines={2}
              >
                {selectedPreset?.name ?? 'Board presets'}
              </Text>
              <CaretRightIcon size={15} color={theme.neutral.textMuted} />
            </View>
          </Pressable>
        </View>
      </View>

      <EdgeDrawer
        visible={sheet !== null}
        triggerRef={sheet === 'rails' ? railTriggerRef : presetTriggerRef}
        contentPageKey={
          sheet === 'rails' ? `rails:${railBrand ?? ''}` : `presets:${presetBrand ?? ''}`
        }
        onClose={() => setSheet(null)}
        title={sheet === 'rails' ? (railBrand ?? 'Custom build') : (presetBrand ?? 'Board presets')}
        icon={SquaresFourIcon}
        iconColor={theme.palette.cyan.color}
      >
        <View style={sheet === 'rails' ? undefined : styles.sheetBody}>
          {sheet === 'rails' ? (
            <CustomRailPickerContent
              brand={railBrand}
              onBrandChange={setRailBrand}
              railId={wizard.railId}
              railColorId={wizard.railColorId}
              onSelect={(railId) => {
                const option = CUSTOM_RAIL_OPTIONS.find((item) => item.railId === railId)
                if (option) wizard.selectCustomRail(option.id)
                setSheet(null)
              }}
            />
          ) : presetBrand === null ? (
            BOARD_PRESET_BRANDS.map((brand) => (
              <CategoryRow key={brand} name={brand} onPress={() => setPresetBrand(brand)} />
            ))
          ) : (
            <>
              <BackRow label="All presets" onPress={() => setPresetBrand(null)} />
              {BOARD_PRESETS.filter((preset) => preset.brand === presetBrand).map((preset) => (
                <Pressable
                  key={preset.id}
                  onPress={() => {
                    wizard.selectBoardPreset(preset.id)
                    setSheet(null)
                  }}
                  style={styles.sheetRow}
                >
                  <BoardModelPreview
                    railId={preset.railId}
                    railColorId={wizard.railColorId}
                    size={60}
                    rollDegrees={0}
                  />
                  <Text style={styles.sheetName} numberOfLines={2}>
                    {preset.name}
                  </Text>
                  {selectedPreset?.id === preset.id ? (
                    <CheckIcon size={17} color={theme.palette.cyan.color} />
                  ) : null}
                </Pressable>
              ))}
            </>
          )}
        </View>
      </EdgeDrawer>
    </View>
  )
}

function CategoryRow({ name, onPress }: { name: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.sheetRow}>
      <Text style={styles.sheetName}>{name}</Text>
      <CaretRightIcon size={17} color={theme.neutral.textMuted} />
    </Pressable>
  )
}

function BackRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.sheetBack}>
      <ArrowLeftIcon size={16} color={theme.palette.cyan.color} />
      <Text style={styles.sheetBackText}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: { gap: 24 },
  preview: {
    alignItems: 'center',
    height: 195,
    justifyContent: 'center',
    marginBottom: -16,
    transform: [{ translateY: 16 }],
  },
  nameLine: {
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: theme.neutral.border,
  },
  nameMeasure: { position: 'absolute', opacity: 0, fontSize: 28, fontWeight: '700' },
  nameInput: {
    height: 58,
    color: theme.neutral.textPrimary,
    fontFamily: font('700'),
    fontSize: 28,
    textAlign: 'center',
    paddingHorizontal: 0,
    paddingVertical: 8,
  },
  namePlaceholder: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    color: theme.neutral.textSecondary,
    fontSize: 28,
    fontWeight: '700',
  },
  choiceRow: { flexDirection: 'row', gap: 16 },
  choiceWrap: { flex: 1 },
  choice: {
    height: 86,
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    borderRadius: 12,
    backgroundColor: theme.neutral.surface,
  },
  choiceSelected: { borderColor: theme.palette.cyan.color },
  choiceEyebrow: { color: theme.neutral.textSecondary, fontSize: 12, fontWeight: '600' },
  choiceValueRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  choiceValue: { flex: 1, fontSize: 14, fontWeight: '700', color: theme.neutral.textPrimary },
  choiceValueSelected: { color: theme.palette.cyan.color },
  sheetBody: { gap: 8, paddingHorizontal: 16, paddingBottom: 18 },
  sheetRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    borderRadius: 12,
    backgroundColor: theme.neutral.surface,
  },
  sheetName: { flex: 1, fontSize: 15, fontWeight: '700', color: theme.neutral.textPrimary },
  sheetBack: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  sheetBackText: { color: theme.palette.cyan.color, fontSize: 13, fontWeight: '700' },
})
