# Legacy Float support removal

Search `rg -n '@legacy-float' modules/vescape-core scripts` to find removal entry points.
Each marker names a support boundary and links here. Markers are navigation aids, not permission
to delete every marked block together. Inspect each `@parity` peer before changing either platform.

## info-v1

Remove only when support ends for **both Float and older Refloat using INFO v1**. The response has
no package name; `Float/Refloat` records that ambiguity. Dropping Float alone does not justify
removing this parser while older Refloat remains supported.

- Update `parseGetInfoResponse` and remove `parseGetInfoV1` in both `RefloatConfigProtocol` files.
  Unsupported INFO must fail explicitly, never be interpreted as INFO v2.
- Replace legacy success cases in both `RefloatConfigProtocolTest.kt` and
  `RefloatConfigProtocolTests.swift` with explicit rejection coverage. Keep INFO v2 coverage.
- Search `Float/Refloat` and legacy INFO payload fixtures across both native test trees.
  Update config read happy-path fixtures, including `ConfigRWFsmTest.kt`, to supported INFO.
  Preserve their config read/write assertions.
- Confirm supported package linking and reconnect still work on both platforms, and unsupported
  package linking ends with an actionable error rather than hanging or offering a link.

## saved-link

Keep compatibility until existing saved identities have been migrated from fresh board evidence,
or a deliberate Board Link Version change requires riders to re-link. Removing INFO v1 wire
support is insufficient: an old saved `Refloat 1.2` can reconnect to a supported package that now
reports `Refloat 1.2.7` through INFO v2.

- Update `packageVersionMatches` and `baseVersionMatches` in both `BoardSession` files, including
  the Android regex constants and their `matches`/`mismatches` callers.
- Update the marked regression groups in `BoardSessionLinkIntegrityTest.kt` and
  `BoardSessionLinkIntegrityTests.swift` to cover the chosen migration or explicit re-link path.
- Preserve rejection tests for actual firmware, package, patch, suffix, and BMS changes, plus
  incomplete observations and the latched mismatch behavior.
- Verify an app upgrade with a pre-existing saved link. Display changes alone must not silently
  clear Board Config Values or block commands. If re-linking is required, make that explicit.
- Keep persisted base-version and Tune Compatibility key handling deliberate; do not infer
  missing package or patch facts from an old display label.

## vesc-602

VESC 6.02 is controller firmware support, independent of the Float package. Remove it only when
the supported controller firmware policy drops that version.

- Remove `release_6_02` from `scripts/generate-mcconf-tables.ts`, then run
  `bun run scripts/generate-mcconf-tables.ts`. Never hand-edit generated `McconfLayouts.kt` or
  `McconfLayouts.swift`; confirm other supported layouts remain unchanged.
- Inspect `I16`/`i16` in the generator and both `McconfDecoder` implementations. Remove that
  decoding path only if no remaining supported layout uses it.
- Update `docs/mcconf.md`. Run both motor-decoder suites and retain structural checks for every
  supported table. Cover the removed signature `776184161` as unsupported, with no fallback.
- Verify unsupported motor config still prevents linking as required by ADR 0036.

## Keep

XML chunk retries, delayed duplicate suppression, and their tests are general transport
reliability behavior. Keep them after legacy package support ends. INFO v2 package names and
exact motor-config signature gating also remain.

After each removal, run the affected native suites on both platforms, search markers and old
labels again, and update this checklist plus [connection state](./connectionState.md).
