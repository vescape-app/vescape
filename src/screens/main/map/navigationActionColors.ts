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
