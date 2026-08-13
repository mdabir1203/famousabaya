# Release notes

This folder holds hand-written release notes, one file per launcher version.
The release workflow picks up `v<version>.md` here and uses it as the body
of the GitHub release automatically.

## Convention

- One file per release: `v<major>.<minor>.<patch>.md`
- File is **committed before tagging** the release — the workflow fails
  fast if a release tag is published without notes.
- File is the source of truth for the GitHub release body and for any
  in-product "what's new" surface that wants a stable URL.

## When a file is missing

`scripts/generate-release-notes.mjs` falls back to a generic
auto-generated notes block (Problem / What changed / Fix) when no
`v<version>.md` exists. The auto-generated notes are not meant to ship
to users — they're a safety net so the workflow doesn't fail. If you
see the `[release-notes] no docs/releases/v<version>.md found` warning
in CI, write the notes and re-run.

## Older releases

This convention started with v1.2.7. Earlier launcher tags (`v1.2.3`
through `v1.2.6`) used the old auto-generated format; if you want to
back-fill them, drop a file in this folder and re-run the workflow's
`Publish GitHub Release` step manually with the existing tag.

## File template

A good release notes file covers:

1. **One-line summary** — what's the headline of this release?
2. **What's in this release** — user-visible changes, grouped by area
   (Removed / Added / Changed / Fixed).
3. **How to install / update** — fresh-install steps and upgrade-in-place
   notes, including any data migration steps.
4. **What to check after upgrading** — 3-5 manual smoke checks a user
   can run to confirm the release is healthy.
5. **Files in this release** — the asset table (installer, blockmap,
   manifest, portable zip if any) with sizes.
6. **What was reverted / removed** — anything deprecated or cleaned up
   so users can search their changelog history.
7. **Compatibility** — OS, Node version, data migration.
