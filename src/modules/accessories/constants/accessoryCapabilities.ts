import { ArrowsVerticalIcon, LightbulbFilamentIcon, QuestionIcon } from 'phosphor-react-native'
import type { Icon } from 'phosphor-react-native'
import type { AccessoryCapability, AccessoryCapabilityType } from 'vescape-core'

interface CapabilityPresentation {
  title: string
  description: string
  icon: Icon
}

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
    title: capability.type,
    description: 'This app does not know this capability type yet.',
    icon: QuestionIcon,
  }
}
