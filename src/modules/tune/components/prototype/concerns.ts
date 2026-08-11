// PROTOTYPE — throwaway. Shared vocabulary for the tune-screen variants.
// Question: how should the tune screen organise raw values so newbies survive
// and power users keep everything? See NOTES.md.

import type { Icon } from 'phosphor-react-native'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  GaugeIcon,
  HandPalmIcon,
  LightningIcon,
  MountainsIcon,
  WaveSineIcon,
} from 'phosphor-react-native'

import { theme } from '@/constants/theme'
import { BASIC_SLIDER_BY_ID, type BasicSliderItem } from '@/modules/tune/lib/sliderDefinitions'

export interface Concern {
  id: string
  title: string
  /** Plain-language, no jargon. What a rider feels when this changes. */
  blurb: string
  icon: Icon
  color: string
  /** Basic slider ids that summarise this concern. */
  sliderIds: string[]
  /** Raw field group ids that belong to this concern. */
  groupIds: string[]
}

export const CONCERNS: Concern[] = [
  {
    id: 'balance',
    title: 'Balance',
    blurb: 'How hard the board fights to stay level under your feet.',
    icon: LightningIcon,
    color: theme.palette.sky.color,
    sliderIds: ['aggressiveness'],
    groupIds: ['general'],
  },
  {
    id: 'push',
    title: 'Nose & tail',
    blurb: 'How much the deck tips when you accelerate or brake.',
    icon: ArrowUpIcon,
    color: theme.palette.teal.color,
    sliderIds: ['noseStiffness', 'tailStiffness'],
    groupIds: ['torque_tiltback'],
  },
  {
    id: 'terrain',
    title: 'Hills',
    blurb: 'Automatic deck angle on climbs and descents.',
    icon: MountainsIcon,
    color: theme.palette.green.color,
    sliderIds: ['atrIntensity'],
    groupIds: ['atr'],
  },
  {
    id: 'carve',
    title: 'Carving',
    blurb: 'Extra lean when you dig into a turn.',
    icon: WaveSineIcon,
    color: theme.palette.pink.color,
    sliderIds: ['carveTilt'],
    groupIds: ['turn_tiltback'],
  },
  {
    id: 'brake',
    title: 'Braking',
    blurb: 'Nose lift while you slow down hard.',
    icon: HandPalmIcon,
    color: theme.palette.orange.color,
    sliderIds: ['brakeTilt'],
    groupIds: ['brake'],
  },
  {
    id: 'speed',
    title: 'Speed limits',
    blurb: 'Tiltback the board uses to warn you off going faster.',
    icon: GaugeIcon,
    color: theme.palette.amber.color,
    sliderIds: [],
    groupIds: ['tiltback'],
  },
]

export const CONCERN_BY_GROUP_ID = new Map(
  CONCERNS.flatMap((c) => c.groupIds.map((g) => [g, c] as const)),
)

export const SLIDER_ICON: Record<string, Icon> = {
  aggressiveness: LightningIcon,
  noseStiffness: ArrowUpIcon,
  tailStiffness: ArrowDownIcon,
  carveTilt: WaveSineIcon,
  brakeTilt: HandPalmIcon,
  atrIntensity: MountainsIcon,
}

/** Word ladders so level 1 never has to show a raw number. */
const STEP_LABELS: Record<string, string[]> = {
  aggressiveness: ['Calm', 'Relaxed', 'Balanced', 'Sharp', 'Race'],
  noseStiffness: ['Flat', 'Soft', 'Medium', 'Stiff', 'Locked'],
  tailStiffness: ['Flat', 'Soft', 'Medium', 'Stiff', 'Locked'],
  carveTilt: ['Off', 'Hint', 'Medium', 'Deep', 'Surfy'],
  brakeTilt: ['Off', 'Light', 'Medium', 'Strong', 'Max'],
  atrIntensity: ['Off', 'Gentle', 'Medium', 'Strong', 'Max'],
}

export const STEP_COUNT = 5

export function stepLabels(sliderId: string): string[] {
  return STEP_LABELS[sliderId] ?? ['Min', 'Low', 'Medium', 'High', 'Max']
}

/** Bucket index 0..4 for a slider value, or null when the value is off-formula/missing. */
export function stepIndex(item: BasicSliderItem): number | null {
  if (item.value == null || item.modifiedManually) return null
  const t = (item.value - item.min) / (item.max - item.min)
  return Math.min(STEP_COUNT - 1, Math.max(0, Math.round(t * (STEP_COUNT - 1))))
}

/** What level 1 shows: a word, never a derived number. */
export function stepLabel(item: BasicSliderItem): string {
  const index = stepIndex(item)
  if (index == null) return item.value == null ? 'Not set' : 'Custom'
  return stepLabels(item.id)[index]
}

export function valueForStep(item: BasicSliderItem, index: number): number {
  const raw = item.min + ((item.max - item.min) * index) / (STEP_COUNT - 1)
  return Math.round(raw / item.step) * item.step
}

export function applySliderValue(
  sliderId: string,
  value: number,
  setDraftField: (fieldId: string, value: number) => void,
) {
  const def = BASIC_SLIDER_BY_ID.get(sliderId)
  if (!def) return
  for (const [fieldId, fieldValue] of Object.entries(def.computeFieldValues(value))) {
    setDraftField(fieldId, fieldValue)
  }
}
