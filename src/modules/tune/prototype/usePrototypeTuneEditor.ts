// THROWAWAY: reuse the real drawer, keeping all edits in this prototype's memory.
import { useState, type RefObject } from 'react'
import type { View } from 'react-native'
import type { FieldEditorTarget } from '@/modules/tune/components/FieldEditorPopover'
import {
  BASIC_SLIDER_BY_ID,
  basicSliderChanges,
  fieldHelp,
  getLinkedFieldPreviews,
} from '@/modules/tune/lib/sliderDefinitions'
import { CONTROLS, GROUPS } from './tuneRingControls'

export function usePrototypeTuneEditor(onChange: (index: number, percent: number) => void) {
  const [editor, setEditor] = useState<{
    target: FieldEditorTarget
    page: number
    index: number
  } | null>(null)
  const [overrides, setOverrides] = useState<Record<string, Record<string, number>>>({})
  const clear = (page: number, index?: number) =>
    setOverrides((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([key]) =>
          index == null ? !key.startsWith(`${page}:`) : key !== `${page}:${index}`,
        ),
      ),
    )
  const open = (
    page: number,
    index: number,
    percent: number,
    triggerRef: RefObject<View | null>,
    color: string,
  ) => {
    const control = CONTROLS[page][index]
    const definition = BASIC_SLIDER_BY_ID.get(control.id)
    const toReal = (value: number) => control.min + (value / 10) * (control.max - control.min)
    const currentFields = {
      ...(definition?.computeFieldValues(toReal(percent / 10)) ?? {}),
      ...overrides[`${page}:${index}`],
    }
    setEditor({
      page,
      index,
      target: {
        triggerRef,
        label: GROUPS[page].labels[index],
        description:
          definition?.description ?? fieldHelp({ ...control, value: toReal(percent / 10) }),
        fieldId: control.id,
        value: Number((percent / 10).toFixed(1)),
        min: 0,
        max: 10,
        step: 0.1,
        manualDecimals: 1,
        unit: null,
        help: `${definition?.info ?? fieldHelp({ ...control, value: 0 })}\n\nPrototype scale: 0 to 10 maps to ${control.min} to ${control.max}${control.unit ? ` ${control.unit}` : ''}.`,
        color,
        linkedFields: definition
          ? getLinkedFieldPreviews(definition).map((field) => ({
              ...field,
              currentValue: currentFields[field.id],
              computeValue: (value: number) => field.computeValue(toReal(value)),
            }))
          : [
              {
                id: control.id,
                label: control.label,
                unit: control.unit,
                min: control.min,
                max: control.max,
                step: control.step,
                currentValue: overrides[`${page}:${index}`]?.[control.id] ?? toReal(percent / 10),
                computeValue: toReal,
              },
            ],
      },
    })
  }
  const apply = (value: number, linked?: Record<string, number>) => {
    if (!editor) return
    const { page, index, target } = editor
    const control = CONTROLS[page][index]
    const definition = BASIC_SLIDER_BY_ID.get(control.id)
    const toReal = (v: number) => control.min + (v / 10) * (control.max - control.min)
    const fields = definition
      ? basicSliderChanges(definition, toReal(value), toReal(target.value), linked)
      : { [control.id]: toReal(value), ...linked }
    const currentFields = Object.fromEntries(
      target.linkedFields?.map((field) => [
        field.id,
        field.currentValue ?? field.computeValue(target.value),
      ]) ?? [],
    )
    const nextFields = { ...currentFields, ...fields }
    const derived =
      definition?.deriveSliderValue(new Map(Object.entries(nextFields))) ?? nextFields[control.id]
    onChange(index, ((derived - control.min) / (control.max - control.min)) * 100)
    setOverrides((current) => ({ ...current, [`${page}:${index}`]: nextFields }))
    setEditor(null)
  }
  return {
    target: editor?.target ?? null,
    open,
    apply,
    clear,
    close: () => setEditor(null),
    clearAll: () => setOverrides({}),
  }
}
