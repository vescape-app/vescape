import { useState, type RefObject } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { CaretRightIcon, PencilSimpleIcon } from 'phosphor-react-native'

import { Button } from '@/components/base/Button'
import { Text } from '@/components/base/Text'
import { EdgeDrawer } from '@/components/overlays/EdgeDrawer'
import { theme, personalizationColorOptions } from '@/constants/theme'
import { AnimatedBoardPreview } from '@/modules/board/components/add-board-wizard/AnimatedBoardPreview'
import {
  BoardColorPicker,
  type RailColorId,
} from '@/modules/board/components/add-board-wizard/BoardColorPicker'
import { CustomRailPickerContent } from '@/modules/board/components/CustomRailPickerContent'
import type { RailBrand } from '@/modules/board/lib/boardPresets'
import { railPreset, type RailId } from '@/modules/board/lib/railPresets'

export function BoardAppearanceEditorSheet({
  visible,
  triggerRef,
  railId,
  railColorId,
  onClose,
  onSave,
}: {
  visible: boolean
  triggerRef: RefObject<View | null>
  railId?: string
  railColorId?: string
  onClose: () => void
  onSave: (railId: RailId, railColorId: RailColorId) => Promise<void>
}) {
  const [draftRailId, setDraftRailId] = useState<RailId>(() => railPreset(railId).id)
  const [draftColorId, setDraftColorId] = useState<RailColorId>(() => validColorId(railColorId))
  const [railPage, setRailPage] = useState(false)
  const [brand, setBrand] = useState<RailBrand | null>(null)
  const [saving, setSaving] = useState(false)

  const [previousInputs, setPreviousInputs] = useState({ visible, railId, railColorId })
  if (
    previousInputs.visible !== visible ||
    previousInputs.railId !== railId ||
    previousInputs.railColorId !== railColorId
  ) {
    setPreviousInputs({ visible, railId, railColorId })
    if (visible) {
      setDraftRailId(railPreset(railId).id)
      setDraftColorId(validColorId(railColorId))
      setRailPage(false)
      setBrand(null)
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      await onSave(draftRailId, draftColorId)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <EdgeDrawer
      visible={visible}
      triggerRef={triggerRef}
      onClose={onClose}
      title={railPage ? (brand ?? 'Change rail model') : 'Board appearance'}
      icon={PencilSimpleIcon}
      iconColor={theme.palette.cyan.color}
      contentPageKey={railPage ? `rails:${brand ?? ''}` : 'appearance'}
    >
      {railPage ? (
        <CustomRailPickerContent
          brand={brand}
          onBrandChange={setBrand}
          railId={draftRailId}
          railColorId={draftColorId}
          onBack={() => setRailPage(false)}
          onSelect={(selected) => {
            setDraftRailId(selected)
            setRailPage(false)
          }}
        />
      ) : (
        <View style={styles.content}>
          <View style={styles.preview}>
            <AnimatedBoardPreview railId={draftRailId} railColorId={draftColorId} size={220} />
          </View>
          <BoardColorPicker railColorId={draftColorId} onRailColorChange={setDraftColorId} />
          <Pressable
            style={styles.railButton}
            onPress={() => {
              setBrand(null)
              setRailPage(true)
            }}
            accessibilityRole="button"
          >
            <View style={styles.railText}>
              <Text style={styles.railLabel}>Change rail model</Text>
              <Text style={styles.railValue}>{railPreset(draftRailId).label}</Text>
            </View>
            <CaretRightIcon size={18} color={theme.neutral.textMuted} />
          </Pressable>
          <Button
            label="Save"
            loading={saving}
            onPress={save}
            testID="edit-board-appearance-save"
          />
        </View>
      )}
    </EdgeDrawer>
  )
}

function validColorId(value?: string): RailColorId {
  return personalizationColorOptions.find((color) => color.id === value)?.id ?? 'cyan'
}

const styles = StyleSheet.create({
  content: { gap: 24, paddingHorizontal: 16, paddingBottom: 24 },
  preview: { height: 155, alignItems: 'center', justifyContent: 'center' },
  railButton: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: theme.neutral.border,
    borderRadius: 12,
    backgroundColor: theme.control.background,
  },
  railText: { flex: 1, gap: 4 },
  railLabel: { color: theme.control.textMuted, fontSize: 12, fontWeight: '600' },
  railValue: { color: theme.control.text, fontSize: 16, fontWeight: '700' },
})
