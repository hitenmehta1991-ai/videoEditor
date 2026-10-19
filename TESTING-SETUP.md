# One-folder testing setup

The user's permanent testing folder is `~/Documents/videoEditor`.
It follows the **testing** branch, containing the latest tested ReelDesk version.

Run this from any Terminal window:

```sh
~/Documents/videoEditor/Update-and-Run.command
```

Or double-click `Update-and-Run.command` in that folder.
Close any older ReelDesk window before starting a new version.

The launcher fetches `testing`, updates by fast-forward only, refreshes npm dependencies when the package files or Node version change, and starts the app. Existing node_modules is reused. It stops if tracked source files have local edits, or local history has diverged; it never resets or stashes user changes. Untracked projects, package locks, and media are preserved. Keep project/media files outside application source paths to avoid future filename conflicts.

Updates happen when this command runs, not as a background service. Internet and the existing GitHub login are needed for updates and changed dependencies. If an update fails, the launcher stops instead of silently launching an older build. To intentionally use the installed version offline:

```sh
~/Documents/videoEditor/Update-and-Run.command --offline
```

To update and prepare dependencies without opening the app:

```sh
~/Documents/videoEditor/Update-and-Run.command --update-only
```

Node/npm and FFmpeg/FFprobe are installed once on this Mac. The launcher handles application dependency changes; it does not install system packages or alter Git credentials. The FFmpeg build must contain the filters used by a project; the existing drawtext limitation still applies to titles.

## Publishing future testing versions

Start future feature branches from the latest `testing` commit so this launcher and the setup remain included. After the authorized feature work passes its checks, publish its commit to `testing` using a fast-forward update with an expected-head check. Feature PRs can remain separate from stable production `main`. Do not select versions by sorting branch names; the testing branch is the explicit release channel.

GitHub changes do not push files directly onto the Mac. The launch command pulls the latest testing commit into this same Documents folder every time. This provides one command for the user's update-and-test workflow without a scheduled background process.
