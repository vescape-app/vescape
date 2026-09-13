import { CircuitryIcon } from 'phosphor-react-native'
import type { Icon } from 'phosphor-react-native'

/**
 * The single mark for an Accessory, wherever one is shown.
 *
 * Kept here rather than picked per screen so the Board selector's row, the detail screen, the scan
 * screen and the top bar's live badge are recognisably the same thing. A plug was the wrong mark:
 * the Board's own link timeline already wears it, so "connected" and "accessory" read alike.
 */
export const AccessoryIcon: Icon = CircuitryIcon
