#!/bin/zsh
# Double-click from Finder after extracting the folder, or run from Terminal.
cd -- "${0:A:h}" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
echo 'ReelDesk Studio — local video editor'
echo '------------------------------------'
if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js is missing. Install Homebrew and run: brew install node'
  read '?Press Enter to exit.'
  exit 1
fi
if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v ffprobe >/dev/null 2>&1; then
  echo 'FFmpeg/FFprobe missing. Install them with: brew install ffmpeg'
  read '?Press Enter to exit.'
  exit 1
fi
if [[ ! -d node_modules ]]; then
  echo 'Installing application dependencies (first launch only)...'
  npm install || { echo 'Dependency install failed'; read '?Press Enter to exit.'; exit 1; }
fi
npm start
