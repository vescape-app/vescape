/** Display arithmetic noise compactly without changing the underlying draft. */
export function formatManualTuneValue(value: number): string {
  return String(Number(value.toPrecision(15)))
}

export function parseManualTuneValue(
  text: string,
  decimals: number,
  unchangedValue?: number,
): { value: number; error: null } | { value: null; error: string } {
  const normalized = text.trim().replace(',', '.')
  // Opening a precise native value is not an edit or consent to normalize its precision.
  if (
    unchangedValue !== undefined &&
    Number.isFinite(unchangedValue) &&
    (normalized === String(unchangedValue) || normalized === formatManualTuneValue(unchangedValue))
  )
    return { value: unchangedValue, error: null }
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
