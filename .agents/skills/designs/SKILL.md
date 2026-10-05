---
name: designs
description: Create, inspect, or correct Vescape's editable Penpot components and screens. Use for design work and app-to-design fidelity; use designs-update for syncing changes since the recorded dev checkpoint.
---

# Vescape designs

Read [the workspace reference](references/workspace.md) for the file, pages, source mapping,
and MCP access. For checkpoint or coverage changes, read [the sync contract](references/sync.md).

## Work from the implementation

1. Inspect the existing Penpot nodes and relevant app source before drawing. Follow the route
   through its screen composition and shared components, including inherited navigation options.
   Read `docs/design.md`, `docs/agents/react.md`, and the relevant entries in `docs/index.md`.
2. Identify the requested states and both light and dark appearances. Reuse existing library
   components and tokens. Preserve unrelated canvas work and component IDs when possible.
3. Build or update the reusable component first, then its screen instances. Use native editable
   text, vector paths, and Penpot flex/grid auto layout. Set padding, gap, alignment, sizing,
   min/max constraints, and wrapping from the app. Test a longer label and a narrower frame.
   Use absolute positioning for actual app overlays, map layers, and chart geometry, with an
   explicit parent and clipping boundary. A board full of fixed coordinates is not auto layout.
4. Check the rendered result using the verification rules below. Update coverage/provenance
   for new designs. Ordinary design edits do not advance the global sync checkpoint.
5. Report the Penpot link, changed screens/components, verification, and remaining approximations.

## Structure and fidelity

- Keep `Components` and `Screens` as separate pages. Organize components by the app's ownership:
  domain-less `src/components/`, domain components under `src/modules/<feature>/components/`,
  and screen composition under `src/screens/` or module screens. Routes remain thin entry points.
  Record repository-relative source paths in the coverage catalog rather than duplicating TS code.
- Present screens with one state per row, light on the left and dark on the right. Keep matching
  frames aligned and labeled so themes and states can be compared without searching the canvas.
- Use shared instances for repeated headers, controls, cards, and rows. Maintain light/dark
  variants and relevant selected, disabled, warning, empty, and connected states for the task.
  Add new component previews to the Penpot Components page. App showcase edits belong only to
  tasks that also change the app implementation.
- Resolve actual fonts, weights, line heights, colors, and icon props from source. Current fonts
  are Raleway for UI and JetBrains Mono for readouts. Use the installed Phosphor icon's exact
  path and weight, including wrapper defaults. Similar-looking icons or Unicode substitutes
  are not faithful imports. Compare optical alignment, not only bounding boxes.
- Inspect the whole header: status/safe area, left and right control containers, title position,
  route-specific actions, and spacing. Concrete regression: the app's centered Settings title
  and circular back button were recreated as a large left-aligned title and bare arrow. Trace
  `src/app/_layout.tsx`, `HeaderBackButton`, `IconButton`, and screen-specific options together;
  do not propagate the existing incorrect PoC header as a template.
- Light mode is semantic, not a global color inversion. Navy interactive controls retain their
  control colors; surrounding surfaces, text, metric accents, and map shading follow light tokens.
- Keep bitmap use explicit: map captures and other inherently raster content may be image layers;
  labels, controls, gauges, and layout stay editable. Keep map attribution. Label screenshot
  references separately from editable screens and mark approximate chart samples as illustrative.
- Preserve intentional design-only proposals; mark them as proposals with their source status.
  Resolve a conflict with an accepted proposal before overwriting it during code synchronization.

## Verification proportional to the change

For every change, export or inspect the rendered Penpot result in each affected theme. Check
text baseline, horizontal/vertical centering, icon shape/weight, wrapping, clipping, and instance
propagation. API success and correct-looking property values do not prove correct rendering.
Audit prototype destinations and interaction data separately from clicking the rendered prototype.
Report configured links as configured; call navigation tested only after exercising those links.

For a new screen, feature, shared header, or substantial layout/component change, use an Android
emulator and compare against fresh screenshots. Read the repo's `ss`, `nav`, and, when needed,
`adb-debugging` skills. Confirm a current-workspace development build attached to Metro, or build
and install a fresh screenshot/release build at the intended commit. An old installed APK is not
evidence. Use matching logical viewport size, font scale, theme, safe areas, and UI state; convert
physical screenshot pixels using the emulator density. Prefer existing fixture/replay workflows
for representative telemetry. Inspect a capture runner's data-reset behavior before using it;
use a disposable emulator for fixture staging, keeping personal devices/data intact.

Small copy, color, or alignment fixes need source inspection and Penpot render verification;
they do not require another emulator build. If emulator verification is required but unavailable,
leave that verification pending and report the limitation instead of calling the screen verified.

## Improve this skill while using it

When a real failure exposes a missing rule, update the relevant section or
[Penpot implementation notes](references/penpot.md) in this task. Record the smallest general
lesson and its verification, replace stale guidance, and mention the skill change in the report.
Keep session logs, screenshots, credentials, and task checklists out of the skill. Read the
implementation notes when importing SVGs, changing themes, or using the fallback MCP client.
