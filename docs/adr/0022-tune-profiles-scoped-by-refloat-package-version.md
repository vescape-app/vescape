# Tune profiles are scoped by Refloat package version

Tune Profiles are retained per Board and grouped by Refloat major/minor version. Patch versions, suffixes, and fork labels do not split Tune Compatibility: `1.2`, `1.2.0`, and `1.2.7-postfix` all belong to `1.2`. Different major/minor versions remain separate, with older profiles retained for rollback/reflash scenarios.

INFO v1 exposes only major/minor; INFO v2 adds patch and package details. An app update that requests INFO v2 must not hide existing profiles from the unchanged Board. Reads compare both requested and stored versions by major/minor, including existing three-part keys, without rewriting profile values or history. New profiles store major/minor. Empty legacy version keys remain unscoped because their compatibility is unknown.

Board Firmware Identity and Link Integrity keep exact reported versions. Tune compatibility does not weaken those checks or schema validation before writing.

When a trusted board read finds no Tune Profile for the current Refloat major/minor version, the app waits for an explicit rider action such as "Create tune based on board config" before creating the first profile from the board. Tune writes remain read-before-write and schema-validated as described in [ADR 0001](./0001-tune-profile-storage-and-sync.md), but Refloat-version compatibility gates which profiles can be selected or pushed.
