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

test('current source uses only reviewed fixed dark colors and no static neutral divider', () => {
  expect(checkSourceThemeColors()).toEqual([])
})
