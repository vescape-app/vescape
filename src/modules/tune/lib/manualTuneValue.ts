export function parseManualTuneValue(
  text: string,
  decimals: number,
): { value: number; error: null } | { value: null; error: string } {
  const normalized = text.trim().replace(',', '.')
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) {
    return { value: null, error: 'Enter a number.' }
  }
  const value = Number(normalized)
  if (!Number.isFinite(value)) {
    return { value: null, error: 'Enter a finite number.' }
  }
  const fraction = normalized.split('.')[1]?.replace(/0+$/, '') ?? ''
  if (fraction.length > decimals) {
    return {
      value: null,
      error: decimals === 0 ? 'Enter a whole number.' : `Use up to ${decimals} decimal places.`,
    }
  }
  return { value, error: null }
}
