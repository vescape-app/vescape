import type { ThemeColor } from '@/constants/theme'
import { useCallback, useMemo, useState } from 'react'
import type { View } from 'react-native'
import type { TuneProfile, TuneProfileFieldValue } from 'vescape-core'

import type { FieldEditorTarget } from '@/modules/tune/components/FieldEditorPopover'
import { basicSliderColor, basicSliderIcon } from '@/modules/tune/components/basicSliderIcons'
import type { Board } from '@/modules/board/store/boardStore'
import type { ResolvedBoardConfigField } from '@/modules/board/lib/refloatFieldOverlay'
import { useTuneProfileStore } from '@/modules/tune/store/tuneProfileStore'
import { formatTuneValue, tuneDisplayScale } from '@/modules/tune/lib/fields'
import {
  BASIC_SLIDER_BY_ID,
  basicSliderChanges,
  fieldHelp,
  fieldStep,
  getLinkedFieldPreviews,
  isEditableNumberField,
  type BasicSliderItem,
} from '@/modules/tune/lib/sliderDefinitions'
import { DASH } from '@/helpers/format'
import {
  DEFAULT_TUNE_PROFILE_COLOR,
  DEFAULT_TUNE_PROFILE_ICON,
} from '@/modules/tune/lib/profileMetadata'

type InfoModalState = { title: string; message: string } | null
type EditorKind =
  { kind: 'field'; fieldId: string; displayScale: number } | { kind: 'basic'; sliderId: string }

export function useTuneModals(
  activeProfile: TuneProfile | null,
  basicSliders: BasicSliderItem[],
  draftFields: Record<string, TuneProfileFieldValue>,
  allBoards: Board[],
  selectedBoardId: string | null,
  resolvedFieldsById?: ReadonlyMap<string, ResolvedBoardConfigField>,
) {
  const setDraftField = useTuneProfileStore((s) => s.setDraftField)
  const storeCreateProfile = useTuneProfileStore((s) => s.createProfile)
  const storeRenameProfile = useTuneProfileStore((s) => s.renameProfile)
  const storeDeleteProfile = useTuneProfileStore((s) => s.deleteProfile)
  const storeCopyProfile = useTuneProfileStore((s) => s.copyProfileToBoard)

  const [infoModal, setInfoModal] = useState<InfoModalState>(null)
  const [editor, setEditor] = useState<FieldEditorTarget | null>(null)
  const [editorKind, setEditorKind] = useState<EditorKind | null>(null)
  const [metadataModalProfile, setMetadataModalProfile] = useState<TuneProfile | null>(null)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [createCloneFromId, setCreateCloneFromId] = useState<string | undefined>()
  const [copySourceProfile, setCopySourceProfile] = useState<TuneProfile | null>(null)
  const [copyTargetBoard, setCopyTargetBoard] = useState<Board | null>(null)
  const [deleteConfirmProfile, setDeleteConfirmProfile] = useState<TuneProfile | null>(null)

  const showBadgeInfo = useCallback((title: string, message: string) => {
    setInfoModal({ title, message })
  }, [])

  const showFieldInfo = useCallback((field: ResolvedBoardConfigField) => {
    const scale = field.displayScale
    const limits =
      field.min != null || field.max != null
        ? `\n\nRange: ${field.min != null ? formatTuneValue(field.min * scale) : DASH} to ${
            field.max != null ? formatTuneValue(field.max * scale) : DASH
          }${field.unit ? ` ${field.unit}` : ''}`
        : ''
    const units = field.unit ? `\nUnit: ${field.unit}` : ''
    const enums = field.enumNames.length > 0 ? `\nOptions: ${field.enumNames.join(', ')}` : ''
    setInfoModal({
      title: field.label,
      message: `${fieldHelp(field)}${units}${limits}${enums}\nField ID: ${field.id}`,
    })
  }, [])

  const openFieldEditor = useCallback(
    (field: ResolvedBoardConfigField, ref: { current: View | null }, color?: ThemeColor) => {
      if (!activeProfile) {
        showFieldInfo(field)
        return
      }
      if (!isEditableNumberField(field)) {
        showBadgeInfo(
          field.label,
          `${fieldHelp(field)}\n\nThis field is not numeric or has no schema bounds, so it cannot use the slider editor yet.\nField ID: ${field.id}`,
        )
        return
      }
      const scale = field.displayScale
      const limit =
        field.hardMin != null && field.hardMax != null
          ? { min: field.hardMin * scale, max: field.hardMax * scale }
          : null
      setEditorKind({ kind: 'field', fieldId: field.id, displayScale: scale })
      setEditor({
        triggerRef: ref as React.RefObject<View | null>,
        label: field.label,
        fieldId: field.id,
        value: (field.value as number) * scale,
        min: field.min! * scale,
        max: field.max! * scale,
        step: fieldStep(field) * scale,
        manualDecimals: field.manualDecimals ?? 3,
        limit,
        unit: field.unit,
        help: fieldHelp(field),
        color,
      })
    },
    [activeProfile, showBadgeInfo, showFieldInfo],
  )

  const openBasicSliderEditor = useCallback(
    (sliderId: string, ref: { current: View | null }) => {
      if (!activeProfile) return
      const def = BASIC_SLIDER_BY_ID.get(sliderId)
      const item = basicSliders.find((s) => s.id === sliderId)
      if (!def || !item) return
      setEditorKind({ kind: 'basic', sliderId })
      setEditor({
        triggerRef: ref as React.RefObject<View | null>,
        label: item.label,
        description: item.description,
        fieldId: item.id,
        value: item.value ?? item.min,
        min: item.min,
        max: item.max,
        step: item.step,
        unit: null,
        help: `${item.info}\n\nSource: ${item.source}`,
        icon: basicSliderIcon(item.id),
        color: basicSliderColor(item.id),
        linkedFields: getLinkedFieldPreviews(def, resolvedFieldsById).map((field) => {
          const value = draftFields[field.id] ?? activeProfile.fields[field.id]
          return { ...field, currentValue: typeof value === 'number' ? value : undefined }
        }),
      })
    },
    [activeProfile, basicSliders, draftFields, resolvedFieldsById],
  )

  const handleEditorApply = useCallback(
    (value: number, linkedFieldValues?: Record<string, number>) => {
      if (!editorKind || !editor) return
      if (editorKind.kind === 'field') {
        const scale = editorKind.displayScale || tuneDisplayScale(editorKind.fieldId)
        setDraftField(editorKind.fieldId, value / scale)
      } else {
        const def = BASIC_SLIDER_BY_ID.get(editorKind.sliderId)
        if (def) {
          const fieldValues = basicSliderChanges(def, value, editor.value, linkedFieldValues)
          for (const [id, v] of Object.entries(fieldValues)) {
            setDraftField(id, v)
          }
        }
      }
      setEditor(null)
      setEditorKind(null)
    },
    [editorKind, editor, setDraftField],
  )

  const closeEditor = useCallback(() => {
    setEditor(null)
    setEditorKind(null)
  }, [])

  const handleBasicSliderReset = useCallback(
    (sliderId: string) => {
      const formula = BASIC_SLIDER_BY_ID.get(sliderId)
      if (!formula || !activeProfile) return
      const currentValue = formula.deriveSliderValue(
        new Map(
          Object.entries({ ...activeProfile.fields, ...draftFields })
            .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
            .map(([k, v]) => [k, v]),
        ),
      )
      if (currentValue == null) return
      const fieldValues = formula.computeFieldValues(Math.round(currentValue))
      for (const [fieldId, value] of Object.entries(fieldValues)) {
        setDraftField(fieldId, value)
      }
    },
    [activeProfile, draftFields, setDraftField],
  )

  const handleCreateProfile = useCallback((cloneFromId?: string) => {
    setCreateCloneFromId(cloneFromId)
    setCreateModalOpen(true)
  }, [])

  const handleCopyToBoard = useCallback((board: Board) => {
    setCopyTargetBoard(board)
  }, [])

  const handleCopyConfirm = useCallback(
    async (name: string) => {
      if (!copySourceProfile || !copyTargetBoard) return
      await storeCopyProfile(copySourceProfile.id, copyTargetBoard.id, name)
      setCopySourceProfile(null)
      setCopyTargetBoard(null)
    },
    [copySourceProfile, copyTargetBoard, storeCopyProfile],
  )

  const otherBoards = useMemo(
    () => allBoards.filter((b) => b.id !== selectedBoardId),
    [allBoards, selectedBoardId],
  )

  return {
    infoModal,
    setInfoModal,
    editor,
    editorKind,
    metadataModalProfile,
    setMetadataModalProfile,
    createModalOpen,
    setCreateModalOpen,
    createCloneFromId,
    copySourceProfile,
    setCopySourceProfile,
    copyTargetBoard,
    setCopyTargetBoard,
    deleteConfirmProfile,
    setDeleteConfirmProfile,
    showBadgeInfo,
    showFieldInfo,
    openFieldEditor,
    openBasicSliderEditor,
    handleEditorApply,
    closeEditor,
    handleBasicSliderReset,
    handleCreateProfile,
    handleCopyToBoard,
    handleCopyConfirm,
    otherBoards,
    storeCreateProfile,
    storeRenameProfile,
    storeDeleteProfile,
    defaultTuneIcon: DEFAULT_TUNE_PROFILE_ICON,
    defaultTuneColor: DEFAULT_TUNE_PROFILE_COLOR,
  }
}
