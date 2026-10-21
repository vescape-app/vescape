import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

// These fixed dark colors belong to map, chart, telemetry, or developer-only visuals. Keep the list
// exact: another use, even in an approved file, must be reviewed.
const fixedDarkUses: Record<string, number> = {
  'src/components/charts/LinearGaugeBar.tsx': 1,
  'src/components/charts/SparklineLayer.tsx': 1,
  'src/components/charts/line/ScrubLayer.tsx': 3,
  'src/modules/board/components/DualGaugePair.tsx': 1,
  'src/modules/board/components/FootpadIndicator.tsx': 3,
  'src/modules/board/components/RimTempArc.tsx': 1,
  'src/modules/board/components/metricDetailData.ts': 1,
  'src/modules/board/constants/telemetry.ts': 1,
  'src/modules/board/constants/telemetryThresholds.ts': 1,
  'src/modules/diagnostics/components/DevBadge.tsx': 8,
  'src/modules/group-ride/lib/riderColor.ts': 1,
  'src/modules/history/components/RouteSparkline.tsx': 1,
  'src/modules/history/hooks/useHistoryChartData.ts': 1,
  'src/modules/history/lib/metricColorScale.ts': 1,
  'src/modules/map/constants/mapStyles.ts': 2,
  'src/modules/map/constants/satelliteDarkMapStyle.ts': 1,
  'src/screens/main/map/RouteZoomFocus.tsx': 3,
}

// Mapbox's authored One Dark paint values and the satellite backdrop are deliberately
// fixed. They are map-style data, not UI surfaces that follow the app appearance.
const fixedMapStyleFiles = new Set([
  'src/modules/map/constants/oneDarkBaseLayers.ts',
  'src/modules/map/constants/oneDarkOverlayLayers.ts',
  'src/modules/map/constants/satelliteDarkLayers.ts',
  'src/modules/map/constants/satelliteDarkMapStyle.ts',
])

const rawColorPattern =
  /^(?:#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8}|(?:rgb|rgba|hsl|hsla)\([^)]*\))$/i

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [path] : []
  })
}

function isThemePath(node: ts.Node, path: string): boolean {
  return ts.isPropertyAccessExpression(node) && node.getText() === path
}

function isInsideStaticStyle(node: ts.Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isCallExpression(parent) && parent.expression.getText() === 'StyleSheet.create')
      return true
  }
  return false
}

/** Static checks for theme mistakes that TypeScript cannot detect. */
export function checkThemeColors(source: string, filename: string): string[] {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true)
  const problems: string[] = []
  let fixedDarkCount = 0

  function report(node: ts.Node, message: string) {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart(file))
    problems.push(`${filename}:${line + 1}: ${message}`)
  }

  function visit(node: ts.Node) {
    if (isThemePath(node, 'theme.palette.slate')) fixedDarkCount++

    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      rawColorPattern.test(node.text.trim()) &&
      filename !== 'src/constants/theme.ts' &&
      !fixedMapStyleFiles.has(filename)
    ) {
      report(node, 'define colors in theme.ts or use a reviewed fixed map-style token')
    }

    // Native DynamicColorIOS / PlatformColor values in a static style can keep the
    // previous appearance after a forced in-app switch. This exact divider pattern
    // caused #563 to regress; compute it from useResolvedNeutralColors() in render.
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(file) === 'theme.alpha' &&
      node.arguments[0]?.getText(file) === 'theme.neutral.border' &&
      isInsideStaticStyle(node)
    ) {
      report(node, 'resolve neutral.border during render before applying alpha')
    }

    ts.forEachChild(node, visit)
  }

  visit(file)
  const expected = fixedDarkUses[filename] ?? 0
  if (fixedDarkCount !== expected) {
    problems.push(
      `${filename}: fixed theme.palette.slate uses: ${fixedDarkCount}, approved: ${expected}`,
    )
  }
  return problems
}

export function checkSourceThemeColors(root = process.cwd()): string[] {
  return sourceFiles(join(root, 'src')).flatMap((path) => {
    const filename = relative(root, path).replaceAll('\\', '/')
    return checkThemeColors(readFileSync(path, 'utf8'), filename)
  })
}

if (import.meta.main) {
  const problems = checkSourceThemeColors()
  if (problems.length > 0) {
    console.error(problems.join('\n'))
    process.exitCode = 1
  } else {
    console.log('Theme color source check passed')
  }
}
