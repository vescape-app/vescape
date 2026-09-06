import { useCallback, useMemo, useState } from 'react'
import type { View } from 'react-native'
import type { RefloatConfigField, TuneProfile, TuneProfileFieldValue } from 'vescape-core'

import type { FieldEditorTarget } from '@/modules/tune/components/FieldEditorPopover'
import { basicSliderColor, basicSliderIcon } from '@/modules/tune/components/basicSliderIcons'
import type { Board } from '@/modules/board/store/boardStore'
import { useTuneProfileStore } from '@/modules/tune/store/tuneProfileStore'
import { formatTuneValue } from '@/modules/tune/lib/fields'
import {
  BASIC_SLIDER_BY_ID,
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
type EditorKind = { kind: 'field'; fieldId: string } | { kind: 'basic'; sliderId: string }

export function useTuneModals(
  activeProfile: TuneProfile | null,
  basicSliders: BasicSliderItem[],
  draftFields: Record<string, TuneProfileFieldValue>,
  allBoards: Board[],
  selectedBoardId: string | null,
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

  const showFieldInfo = useCallback((field: RefloatConfigField) => {
    const limits =
      field.min != null || field.max != null
        ? `\n\nRange: ${field.min != null ? formatTuneValue(field.min) : DASH} to ${
            field.max != null ? formatTuneValue(field.max) : DASH
          }${field.unit ? ` ${field.unit}` : ''}`
        : ''
    const units = field.unit ? `\nUnit: ${field.unit}` : ''
    setInfoModal({
      title: field.label,
      message: `${fieldHelp(field)}${units}${limits}\nField ID: ${field.id}`,
    })
  }, [])

  const openFieldEditor = useCallback(
    (field: RefloatConfigField, ref: { current: View | null }, color?: string) => {
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
      setEditorKind({ kind: 'field', fieldId: field.id })
      setEditor({
        triggerRef: ref as React.RefObject<View | null>,
        label: field.label,
        fieldId: field.id,
        value: field.value as number,
        min: field.min!,
        max: field.max!,
        step: fieldStep(field),
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
        linkedFields: getLinkedFieldPreviews(def),
      })
    },
    [activeProfile, basicSliders],
  )

  const handleEditorApply = useCallback(
    (value: number, linkedFieldValues?: Record<string, number>) => {
      if (!editorKind) return
      if (editorKind.kind === 'field') {
        setDraftField(editorKind.fieldId, value)
      } else {
        const def = BASIC_SLIDER_BY_ID.get(editorKind.sliderId)
        if (def) {
          const fieldValues = { ...def.computeFieldValues(value), ...linkedFieldValues }
          for (const [id, v] of Object.entries(fieldValues)) {
            setDraftField(id, v)
          }
        }
      }
      setEditor(null)
      setEditorKind(null)
    },
    [editorKind, setDraftField],
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
    (name: string) => {
      if (!copySourceProfile || !copyTargetBoard) return
      void storeCopyProfile(copySourceProfile.id, copyTargetBoard.id, name)
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
