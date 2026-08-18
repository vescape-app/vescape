import { useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { MarkdownLogoIcon } from 'phosphor-react-native'

import { Markdown } from '@/components/base/Markdown'
import { ShowcaseCard } from '@/components/dev/ShowcaseCard'
import { ChipRow, ToggleRow, ValueRow } from '@/components/dev/ShowcaseControls'
import { IconHero } from '@/components/settings/IconHero'
import { theme } from '@/constants/theme'
import { DASH } from '@/helpers/format'

/** 24×8 solid PNG — inline so the "loaded" case works without a network. */
const OK_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAICAMAAADUf89RAAAAA1BMVEUDaaGw0sATAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQI12NgGB4AAADIAAF8Y2l9AAAAAElFTkSuQmCC'

const BROKEN_IMAGE = 'https://vescape.app/this-image-does-not-exist.png'

const SAMPLES = {
  overview: `# Release 1.4.0

Firmware compatibility changed, so **update soon** — *balance tuning* stays local either way.

## What changed

- Refloat config reads the new \`float_conf\` layout
- Group Ride rejects ~~stale~~ incompatible clients
- Board Session and Ride Recording are untouched

> An Update Warning never removes a local capability.

Read the [full changelog](https://vescape.app/changelog) or ping us.

---

Version pinning lives in the server config:

\`\`\`json
{ "latest": "1.4.0", "updateWarning": "<1.3.0" }
\`\`\``,

  nesting: `1. Link the board
   1. Scan for peripherals
   2. Pick your VESC
      - Long-press to rename
      - Swipe to forget
3. Tune it
   - Refloat
     - Balance
       - \`kp\`, \`ki\`, \`kd\`
     - Tiltback
   - Stock

- Loose bullet with a nested quote

  > Nested blocks keep their own spacing.

  And a second paragraph inside the same item.`,

  links: `Safe links render as links:

- [https://vescape.app](https://vescape.app)
- [Email support](mailto:support@vescape.app)
- Autolinked: https://vescape.app/docs

Unsafe links degrade to plain label text:

- [tap me](javascript:alert(1))
- [local file](file:///etc/passwd)
- [empty href]()

Raw HTML stays inert: <b onclick="steal()">not bold</b> <script>alert(1)</script>`,

  images: `Loaded image — fills the width, keeps its 3:1 ratio:

![Vescape board](${OK_IMAGE})

Broken image — falls back to alt text:

![Board photo unavailable](${BROKEN_IMAGE})

Unsafe source — never requested, alt text only:

![Blocked image](javascript:alert(1))`,

  table: `| Metric | Value | Unit | Warn at | Critical at | Source |
| :--- | ---: | :-: | ---: | ---: | :--- |
| Speed | 42.5 | km/h | 45 | 50 | \`get_values\` |
| Duty | 78 | % | 80 | 90 | \`get_values\` |
| Motor temp | 61 | °C | 80 | 95 | \`get_values\` |
| Cell spread | 0.27 | V | 0.20 | 0.40 | BMS |

Cells keep inline formatting:

| Field | Note |
| :--- | :--- |
| \`appBlock\` | **Emergency** only — see [ADR 0025](https://vescape.app/adr/0025) |`,
} satisfies Record<string, string>

type Sample = keyof typeof SAMPLES

const SAMPLE_NAMES = Object.keys(SAMPLES) as Sample[]

function MarkdownShowcase() {
  const [sample, setSample] = useState<Sample>('overview')
  const [narrow, setNarrow] = useState(false)
  const [lastLink, setLastLink] = useState(DASH)

  return (
    <ShowcaseCard
      name="Markdown"
      controls={
        <>
          <ChipRow
            label="sample"
            options={SAMPLE_NAMES}
            selected={sample}
            onSelect={(value) => setSample(value as Sample)}
          />
          <ToggleRow label="narrow container" value={narrow} onToggle={setNarrow} />
          <ValueRow label="onLinkPress" value={lastLink} />
        </>
      }
    >
      <View style={narrow ? styles.narrow : undefined}>
        <Markdown onLinkPress={setLastLink}>{SAMPLES[sample]}</Markdown>
      </View>
    </ShowcaseCard>
  )
}

export default function MarkdownComponentsPage() {
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconHero
          icon={MarkdownLogoIcon}
          description="Native Markdown rendering — no WebView. Links, images, nesting, and scrolling tables."
        />
        <MarkdownShowcase />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.palette.slate.bg },
  content: { padding: 12, gap: 12, paddingBottom: 40 },
  narrow: { width: 200 },
})
