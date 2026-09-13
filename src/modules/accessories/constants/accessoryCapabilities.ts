import { ArrowsVerticalIcon, LightbulbFilamentIcon, QuestionIcon } from 'phosphor-react-native'
import type { Icon } from 'phosphor-react-native'
import type { AccessoryCapability, AccessoryCapabilityType } from 'vescape-core'

/**
 * How each recognized capability type is presented. Purely rider-facing: titles, descriptions and
 * icons native never defines. The type slugs themselves come from `vescape-core`, which mirrors the
 * native enums.
 */
interface CapabilityPresentation {
  title: string
  description: string
  icon: Icon
}

/**
 * A `Map`, not an object literal: the key is a wire string from an accessory, and an object lookup
 * would happily answer `constructor` or `toString` with something inherited from `Object.prototype`
 * — truthy, and missing every field this returns.
 */
const PRESENTATION = new Map<AccessoryCapabilityType, CapabilityPresentation>([
  [
    'ground_clearance',
    {
      title: 'Ground clearance',
      description: 'Measures how far the board sits above the ground and can drive Remote Tilt.',
      icon: ArrowsVerticalIcon,
    },
  ],
  [
    'brake_light',
    {
      title: 'Brake light',
      description: 'Shows riding, braking and parked states from the Board’s own telemetry.',
      icon: LightbulbFilamentIcon,
    },
  ],
])

export function capabilityPresentation(capability: AccessoryCapability): CapabilityPresentation {
  const known = PRESENTATION.get(capability.type as AccessoryCapabilityType)
  if (known) return known
  return {
    // An unrecognized type is named by its wire slug rather than hidden — an accessory advertising
    // one is still usable for everything else it offers.
    title: capability.type,
    description: 'This app does not know this capability type yet.',
    icon: QuestionIcon,
  }
}

/** Hardware limits the accessory declared, as one line. Empty when it declared none. */
export function capabilityLimits(capability: AccessoryCapability): string | null {
  const parts: string[] = []
  if (capability.rangeMin != null && capability.rangeMax != null) {
    const unit = capability.unit ?? ''
    parts.push(`${capability.rangeMin}–${capability.rangeMax}${unit ? ` ${unit}` : ''}`)
  }
  if (capability.ratesHz.length > 0) {
    parts.push(`${capability.ratesHz.join(', ')} Hz`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}
