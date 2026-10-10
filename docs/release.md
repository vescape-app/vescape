# Releases

How Vescape versions, notes, and Android releases work.

## Release notes: two tiers

| Tier                                   | Where                                      | Audience     | Authoring                                                    |
| -------------------------------------- | ------------------------------------------ | ------------ | ------------------------------------------------------------ |
| Version notes `release-notes/X.Y.Z.md` | Bundled into the app ("what's new" screen) | Riders       | Codex draft, hand-curated, `New / Improved / Fixed` sections |
| Patch notes                            | GitHub Release body per `vX.Y.Z`           | Devs/testers | Codex-refined commit log, no curation                        |

One file per marketing version, covering only that version. Codex drafts it from the diff between
the previous release tag and the candidate, so a patch's notes describe the patch — nothing else.

A shipped version's notes are **never rewritten**: the copy riders read stays the copy they read.
Late outcomes belong in the next version's file.

The app lists every version at or below the installed one, newest first.

## Tags and GitHub Releases

- Every version that passes an internal build gets an immutable tag `vX.Y.Z` on its build's `source_sha`, plus a GitHub **prerelease** with codex-generated patch notes. The CLI creates both after the internal workflow succeeds (workflows stay `contents: read`).
- **Prerelease flag = not on production yet.** A version that fails Open just stays a prerelease forever; the fix ships as the next patch.
- Production promote validates the version's notes file exists at the exact source SHA, then flips the existing Release to full + latest. It creates nothing new.
- A version that fails the internal build gets no tag — the number is burned, nothing is visible.

## Lifecycle example

```text
prod = 1.0.3

prepare  → minor → 1.1.0, draft release-notes/1.1.0.md (or skip)
internal → build fails → no tag
prepare  → patch → 1.1.1, draft release-notes/1.1.1.md from 1.0.3..HEAD
internal → success → tag v1.1.1 + GH prerelease
promote  → open track (soak)
prepare  → patch → 1.1.2, draft release-notes/1.1.2.md from v1.1.1..HEAD
internal → success → tag v1.1.2 + prerelease
promote  → open → production
           validates 1.1.2.md, flips v1.1.2 to latest
```

## Released App Versions

The server's App Status `latest` is not hand-edited. Once a version reaches production, this
repository tells the server which marketing version that store now serves — the store
credentials stay here, and no Play or App Store Connect key ever reaches the server
(`../vescape-server/docs/adr/0012-released-app-versions-are-pushed-not-polled.md`).

- **Android** — automatic, at the end of `promote-production.yml`, after Play succeeds. A
  failed push does not fail the release; the version is live either way.
- **iOS** — manual. Nothing here releases to the App Store: `fastlane ios release` ships to
  TestFlight and stages a draft, and a human hits Release in App Store Connect. Run
  **Record Released App Version** from the Actions tab once it is live.

The server reports the **lowest** version across the platforms pushed so far, so a Rider is
never told to update to a build their store does not have yet. That also means iOS lagging
behind holds `latest` back until it is recorded — which is the point.

Needs `VESCAPE_INTERNAL_API_KEY` in this repository's `production` environment, matching the
server's `INTERNAL_API_KEY`.

## Production rollout

Every production promotion goes to 100% at once. Staged rollout — percentages, halt, resume,
advance — was removed deliberately; the only production operations are `promote` and `status`.

## Pieces

- `scripts/release/` — release CLI (`prepare`, internal dispatch, promote, production status).
- `scripts/release/releasedVersion.ts` — tells the server a store now serves a version.
- `scripts/release-notes/` — codex authoring, validation, and the bundler that compiles `release-notes/*.md` into `src/modules/release/generated/releaseNotes.ts`.
- `.github/workflows/release-android.yml` — internal build + Play upload from an immutable commit.
- `.github/workflows/promote-open.yml`, `promote-production.yml` — track promotion.
- `.github/workflows/record-released-version.yml` — manual Released App Version push (iOS, and
  the Android retry path).
