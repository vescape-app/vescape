# Penpot implementation notes

These are observed integration behaviors, not a substitute for current MCP API documentation.

- Mutate one active page at a time. Open it before changing its nodes. Scope searches to that
  page root: duplicated prototype pages can retain the same shape IDs. Resolve pages/nodes from
  the file after reconnecting; MCP `storage` values are session-local and not durable metadata.
  Keep page/shape IDs in the durable coverage catalog or a named canvas registry; use temporary
  storage only as a cache. Rebuild the cache from that registry after a session reset.
- Component copies restrict structural edits. Edit their main component; detach only when
  creating an intentional independent variant. Preserve copies and their overrides otherwise.
- Text width/height changes use `resize`; relative positioning uses supported parent-coordinate
  helpers. Use flex/grid layout for ordinary composition instead of manually setting every x/y.
- Match font names exactly: fuzzy lookup for Raleway has returned Raleway Dots. Apply the actual
  weight variant. Center the text frame vertically and horizontally where the app does so.
- Imported SVGs can contain raw SVG nodes and embedded gradient definitions. Updating ordinary
  `fills` may leave the rendered gradient unchanged. Inspect descendants and the export; rebuild
  the affected SVG with the target theme or use native editable paths/gradient fills.
  Check imported paths' local offsets against their parent and SVG viewBox. A correctly placed
  frame can still hide shifted paths behind clipping; inspect the rendered icon at its final size.
- On cloned text, fill/token values have appeared correct while old rich-text runs still rendered
  in the original color. Verify pixels. If range edits do not fix it, recreate only the affected
  text node with explicit font, size, weight, fill, alignment, bounds, and parent/index; preserve
  its semantic role and re-check component propagation. Resized component copies can also retain
  the original text alignment in the rendered output despite correct frame bounds; verify the
  narrow export and recreate the affected text if needed. Do not rebuild whole screens for this.
- Hosted MCP rejected large image-code requests with HTTP 413. For uploadMediaData, chunk base64
  into approximately 48,000-character requests, concatenate in temporary MCP storage, upload,
  then clear the chunks. Do not print image bytes. Uploads are limited to task-relevant assets.
- Export specific screen/component boards for verification. Root/page exports have timed out.
  An SVG import or successful mutation alone is not a visual test.
- The hosted server has returned `Tool execution failed:` as ordinary text without MCP's
  `isError` flag. Treat that result as failure; the fallback client checks both. After a failed
  or interrupted mutation, inspect existing nodes before retrying because earlier edits may persist.
