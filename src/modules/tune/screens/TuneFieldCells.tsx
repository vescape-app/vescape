import { useRef } from 'react'
import type { View } from 'react-native'
import type { RefloatConfigField, TuneProfileFieldValue } from 'vescape-core'

import { theme } from '@/constants/theme'
import { BasicSliderCell } from '@/modules/tune/components/BasicSliderCell'
import { basicSliderColor, basicSliderIcon } from '@/modules/tune/components/basicSliderIcons'
import { TuneConfigCell } from '@/modules/tune/components/TuneConfigCell'
import type { BasicSliderItem } from '@/modules/tune/lib/sliderDefinitions'

export interface BasicSliderItemCellProps {
  item: BasicSliderItem
  editable: boolean
  fullWidth?: boolean
  onPress: (sliderId: string, ref: { current: View | null }) => void
  onResetFormula: () => void
}

export function BasicSliderItemCell({
  item,
  editable,
  onPress,
  onResetFormula,
}: BasicSliderItemCellProps) {
  const cellRef = useRef<View | null>(null)
  return (
    <BasicSliderCell
      ref={cellRef}
      item={item}
      icon={basicSliderIcon(item.id)}
      color={basicSliderColor(item.id)}
      editable={editable}
      onPress={() => onPress(item.id, cellRef)}
      onResetFormula={onResetFormula}
    />
  )
}

export interface TuneFieldCellProps {
  field: RefloatConfigField
  savedValue: TuneProfileFieldValue | undefined
  boardValue: TuneProfileFieldValue | undefined
  profileValue: TuneProfileFieldValue | undefined
  dirty: boolean
  boardChanged: boolean
  onPress: (field: RefloatConfigField, ref: { current: View | null }, color: string) => void
  onRevert: () => void
  onAcceptBoard: () => void
}

export function TuneFieldCell({
  field,
  savedValue,
  boardValue,
  profileValue,
  dirty,
  boardChanged,
  onPress,
  onRevert,
  onAcceptBoard,
}: TuneFieldCellProps) {
  const cellRef = useRef<View | null>(null)
  const color = boardChanged ? theme.palette.green.color : theme.palette.sky.color
  return (
    <TuneConfigCell
      ref={cellRef}
      field={field}
      savedValue={savedValue}
      boardValue={boardValue}
      profileValue={profileValue}
      dirty={dirty}
      boardChanged={boardChanged}
      color={color}
      onPress={() => onPress(field, cellRef, color)}
      onRevert={onRevert}
      onAcceptBoard={onAcceptBoard}
    />
  )
}
