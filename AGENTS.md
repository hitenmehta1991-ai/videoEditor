# ReelDesk development and testing workflow

The user has requested one permanent Mac testing folder at `~/Documents/videoEditor` with a one-command update-and-run workflow. The GitHub `testing` branch is the explicit channel for the latest tested incremental version, separate from production `main` and review PRs.

- Start future feature work from the latest `testing` commit to retain the launcher/setup.
- After requested feature work passes its checks, advance `testing` to the tested commit using a fast-forward, expected-head update. Check its current head before publishing; preserve concurrent changes.
- Keep `Update-and-Run.command` and `TESTING-SETUP.md` in the branch. The launcher handles fetching/testing updates and dependency refreshes when the user runs it.
- Do not reset, stash, delete, or overwrite local user edits or unrelated files. Keep media, saved projects, dependencies, and build output out of source commits.
- The Documents folder is a user testing checkout; honor environment permissions before writing there. Its branch should remain `testing`.
