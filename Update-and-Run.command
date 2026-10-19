#!/bin/zsh
# One stable testing checkout. Run from Terminal or double-click in Finder.
set -eu
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
ROOT="${0:A:h}"
cd -- "$ROOT"
MODE="${1:-}"
if [[ "$MODE" != "" && "$MODE" != "--update-only" && "$MODE" != "--offline" && "$MODE" != "--run-installed" ]]; then
  print -u2 'Usage: ./Update-and-Run.command [--update-only|--offline]'
  exit 1
fi
for tool in git node npm ffmpeg ffprobe; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    print -u2 "Missing $tool. Install the Mac prerequisites once: brew install git node ffmpeg"
    exit 1
  fi
done
if [[ "$(git branch --show-current)" != testing ]]; then
  print -u2 'This launcher expects the testing branch. Keep this folder on testing.'
  exit 1
fi
if [[ "$MODE" != --offline && "$MODE" != --run-installed ]]; then
  if ! git diff --quiet || ! git diff --cached --quiet; then
    print -u2 'Local source changes found. Save or commit them before updating; nothing was overwritten.'
    exit 1
  fi
  print 'Checking for the latest ReelDesk testing version…'
  if ! GIT_TERMINAL_PROMPT=0 git fetch origin refs/heads/testing:refs/remotes/origin/testing; then
    print -u2 'Update check failed. Check your connection or GitHub login, then retry.'
    print -u2 'To run the installed version without updating: ./Update-and-Run.command --offline'
    exit 1
  fi
  git merge --ff-only origin/testing || { print -u2 'Update stopped safely. Local history differs; no files were reset.'; exit 1; }
  # Re-read the newly updated launcher before installing dependencies or opening Electron.
  if [[ "$MODE" != --update-only ]]; then exec /bin/zsh "$ROOT/Update-and-Run.command" --run-installed; fi
fi
cd -- "$ROOT/ReelDesk-Studio"
# Installed dependencies stay in this folder across upgrades. Refresh only after
# a package/lockfile or Node runtime change, or if Electron is missing.
fingerprint() {
  { shasum -a 256 package.json; if [[ -f package-lock.json ]]; then shasum -a 256 package-lock.json; fi; node --version; } | shasum -a 256 | cut -d ' ' -f 1
}
STAMP="node_modules/.reeldesk-dependencies"
EXPECTED="$(fingerprint)"
if [[ ! -x node_modules/.bin/electron || ! -f "$STAMP" || "$(cat "$STAMP")" != "$EXPECTED" ]]; then
  print 'Preparing application dependencies automatically…'
  npm install --no-audit --no-fund
  mkdir -p node_modules
  fingerprint > "$STAMP"
fi
VERSION="$(node -p 'require("./package.json").version')"
print "ReelDesk Studio v${VERSION} is ready in ${ROOT}"
if [[ "$MODE" == --update-only ]]; then exit 0; fi
exec npm start
