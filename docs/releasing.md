# Releasing and the changelog

`CHANGELOG.md` follows [Common Changelog](https://common-changelog.org/). The file holds only
releases, newest first, each headed `## [VERSION] - DATE` with a link to its tag.

## With every commit

A commit that changes what someone using Vital would notice adds its line to the changelog in the
same commit, under the heading of the version the branch is building (`release/v0.3.0` builds
`[0.3.0]`). If that heading does not exist yet, create it at the top.

- **Group** it under `### Changed` (existing behaviour that now works differently, and anything that
  affects the experience), `### Added`, `### Removed` or `### Fixed`, in that order. Leave out a
  group that has no entries.
- **Write one line**, in the imperative: "Add…", "Fix…", "Remove…". Say what a user sees or must do,
  not which files moved. Put breaking changes first and prefix them `**Breaking:**`.
- **End the line with the commit reference** as a link, for example
  ``([`abc1234`](https://github.com/echupkin/vital/commit/abc1234))``. The hash exists once the
  commit does, so add the line in the next commit, or amend it in.
- **Merge related changes** into one line. Skip commits that change nothing a user can see: tests,
  formatting, CI housekeeping.

## At release

1. Set the heading's date to the release date and remove the "release in progress" note.
2. Merge the release branch into `main` with `--no-ff`, then tag it with the branch's version
   (`v0.3.0`). Add the link definition `[0.3.0]: …/releases/tag/v0.3.0` at the bottom.
3. Start the next version's heading in the next commit that needs it.
