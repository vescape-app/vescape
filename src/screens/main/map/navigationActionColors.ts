import { theme } from '@/constants/theme'

/** The Group Ride rider color wins over the default green for navigation affordances. */
export function navigationActionColors(riderColor: string | null) {
  return {
    color: riderColor ?? theme.palette.green.color,
    textColor: riderColor ?? theme.palette.green.text,
  }
}
