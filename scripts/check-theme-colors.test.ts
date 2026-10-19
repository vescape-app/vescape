import { expect, test } from 'bun:test'

import { checkThemeColors, checkSourceThemeColors } from './check-theme-colors'

test('rejects a static adaptive divider and a new fixed dark surface', () => {
  const source = `const styles = StyleSheet.create({
    divider: { backgroundColor: theme.alpha(theme.neutral.border, 0.6) },
    card: { backgroundColor: theme.palette.slate.surface },
  })`

  expect(checkThemeColors(source, 'src/example.tsx')).toEqual([
    'src/example.tsx:2: resolve neutral.border during render before applying alpha',
    'src/example.tsx: fixed theme.palette.slate uses: 1, approved: 0',
  ])
})

test('allows a color computed for the current render', () => {
  const source = `function Divider() {
    const neutral = useResolvedNeutralColors()
    return <View style={{ backgroundColor: theme.alpha(neutral.border, 0.6) }} />
  }`
  expect(checkThemeColors(source, 'src/example.tsx')).toEqual([])
})

test('rejects raw color strings outside the palette and fixed map-style data', () => {
  expect(checkThemeColors("const border = '#334155'", 'src/components/Border.tsx')).toEqual([
    'src/components/Border.tsx:1: define colors in theme.ts or use a reviewed fixed map-style token',
  ])
  expect(checkThemeColors("const border = 'rgba(0,0,0,0.6)'", 'src/components/Border.tsx')).toEqual(
    [
      'src/components/Border.tsx:1: define colors in theme.ts or use a reviewed fixed map-style token',
    ],
  )
  expect(checkThemeColors("const border = '#334155'", 'src/constants/theme.ts')).toEqual([])
  expect(
    checkThemeColors("const border = '#334155'", 'src/modules/map/constants/oneDarkBaseLayers.ts'),
  ).toEqual([])
})

test('current source uses palette colors except reviewed fixed map styles', () => {
  expect(checkSourceThemeColors()).toEqual([])
})
