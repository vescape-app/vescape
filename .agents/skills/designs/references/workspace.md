# Design workspace

Repository: `vescape-app/vescape`. The synchronization target is the remote `dev` branch.

Penpot file: **Vescape UI PoC**, in the user's team.

- Team: `7eed092c-bad6-802e-8008-beb9b441a12b`
- File: `7eed092c-bad6-802e-8008-beba6ea10404`
- Components page: `7eed092c-bad6-802e-8008-beba6ea10405`
- Components / Foundations & UI page: `3b3dbad4-ecc0-80c4-8008-bec709c6d3bb`
- Screens page: `3b3dbad4-ecc0-80c4-8008-bebc8ce5a90d`
- Design sync page: `3b3dbad4-ecc0-80c4-8008-bec36c5e1224`
- Checkpoint text node: `3b3dbad4-ecc0-80c4-8008-bec36c6aefd3`
- [Open Screens](https://design.penpot.app/#/workspace?team-id=7eed092c-bad6-802e-8008-beb9b441a12b&file-id=7eed092c-bad6-802e-8008-beba6ea10404&page-id=3b3dbad4-ecc0-80c4-8008-bebc8ce5a90d)

The `Design sync` page holds the checkpoint and coverage catalog described in [sync.md](sync.md).
Resolve current IDs there and inspect the canvas before mutations. Names alone are not unique IDs.
Initial coverage is Settings, Sounds, and Main telemetry in dark/light, plus their component assets.
This is a partial app catalog, not a claim that all Vescape routes are designed.

Source entry points:

- `src/app/_layout.tsx`: inherited screen header options.
- `src/components/base/HeaderBackButton.tsx`, `IconButton.tsx`: back/control geometry and icon defaults.
- `src/modules/settings/screens/SoundsSettingsScreen.tsx`: Sounds.
- `src/app/settings.tsx`: current Settings screen; `src/screens/main/overlays/SettingsSheet.tsx`
  is a separate overlay, not the route screen.
- `src/screens/main/MainScreen.tsx`, `src/screens/main/overlays/`: telemetry composition.
- `src/modules/board/components/`: gauges, readouts, battery, and board controls.
- `src/constants/theme.ts`, `src/components/base/Text.tsx`, `src/hooks/useSkiaFont.ts`: appearance and fonts.

## Access

Prefer the configured official Penpot MCP. The file must be open in Penpot with its MCP toggle
connected. Use Arc when browser assistance is needed. Query current tool/API documentation before
using unfamiliar methods. Confirm the file ID before writing.

If native MCP tools are not exposed to the current chat, the bundled Bun client can call the
same configured endpoint without installing a plugin or server:

```sh
bun .agents/skills/designs/scripts/penpot.ts tools/list
bun .agents/skills/designs/scripts/penpot.ts tools/call /absolute/path/to/code.js
bun .agents/skills/designs/scripts/penpot.ts tools/call /absolute/path/to/tool-call.json /tmp/penpot-export.png
```

`.js` inputs call `execute_code`; JSON inputs contain MCP tool-call parameters, for example
`{"name":"penpot_api_info","arguments":{"type":"Text"}}`. The client reads only the `penpot`
server section of the user's Codex config. Endpoint URLs may contain credentials: keep them out
of logs, canvas metadata, committed files, and responses. An absent connection is a concrete
blocker, not a reason to install an unknown bridge. Current script behavior is an integration
fallback; the native MCP tools remain preferred.
