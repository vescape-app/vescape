import type { BundledReleaseNote } from '../lib/releaseNotes'

export const bundledReleaseNotes = [
  {
    version: '0.84',
    markdown:
      '## New\n\n- Test your alert setup before a ride. Vescape sweeps a simulated gauge through active thresholds, plays the real sounds or spoken messages, and marks thresholds on the chart without affecting saved rules or live board alerts.\n- View release notes for installed versions anytime from Settings.\n\n## Improved\n\n- Motor and battery current charts now cover the full ±300 A alert range, keeping higher readings and alert thresholds visible.\n\n## Fixed\n\n- Vescape now launches and connects to boards correctly on Android 11 and 12.\n- Tune Profiles now clearly explain missing or unsupported Refloat versions, and Retry re-reads the connected board.\n- Edge drawers now finish closing reliably when another gesture interrupts the animation.\n- The Wear OS splash screen now shows the complete Vescape logo on a black background.\n',
  },
] as const satisfies readonly BundledReleaseNote[]
