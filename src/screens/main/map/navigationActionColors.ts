/** The Group Ride rider color wins over the default green for navigation affordances. */
export function navigationActionColors(
  riderColor: string | null,
  defaultColor: string,
  defaultTextColor: string,
) {
  return {
    color: riderColor ?? defaultColor,
    textColor: riderColor ?? defaultTextColor,
  }
}
