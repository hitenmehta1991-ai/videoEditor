# ReelDesk Studio (macOS desktop video editor)

**A free-to-run, local, no-watermark Reels/Shorts editor prototype.** Built with Electron and FFmpeg. Video files remain on your Mac. Unlike Instagram/Meta's Edits, this is an independent app, not an official product or clone.

## What works in version 0.1

- Import multiple MP4/MOV/M4V/WEBM/MKV/AVI videos; order clips using ↑ ↓, remove unwanted clips
- Preview selected clips, pause/seek, trim start/end, speed at 0.5×–2×
- Export to 9:16 Reels, 4:5, 1:1, 16:9 using **Fit** (black bars) or **Crop** (center crop)
- Add an optional background soundtrack, with volume control. Original audio is preserved.
- Add one timed text overlay to the **whole** export; choose position and color
- Export H.264/AAC MP4 in 720p, 1080p, or 2160p (where feasible), with **no added watermark**
- Save and reopen editable `.json` projects (references original clips; keep them on disk)
- Entirely local; no sign-in, cloud service or analytics; optional soundtrack is only applied to export

## Requirements

- Mac mini running **macOS Ventura (13) or newer** (Intel or Apple Silicon), with enough disk space for video exports
- Node.js (current LTS is recommended) / npm
- FFmpeg and FFprobe installed via Homebrew
- Internet connection **only to download installation dependencies**. Editor itself works offline.

## Install and run on the Mac mini

Open **Terminal**, install [Homebrew](https://brew.sh/) and [Node.js](https://nodejs.org/) if needed, then run:

```bash
brew install ffmpeg node
cd /path/to/ReelDesk-Studio
npm install
npm start
```

### Build a .app / .dmg on your own Mac

```bash
npm run build:mac:dir   # produces an unpacked macOS app under release/
npm run build:mac       # produces a DMG under release/
```

These outputs are **unsigned/not notarized**. macOS Gatekeeper can block them; use `npm start` for local development, or sign/notarize the build with your Apple Developer identity before distributing. **FFmpeg is not bundled**: `brew install ffmpeg` is required on the computer running the editor. FFmpeg is searched in `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin` and `PATH`.

## Quick workflow

1. Click **Import videos** and pick your clips.
2. Click a clip, set **Start** and **End** (in seconds), choose **Playback speed**. Reorder via the up/down buttons.
3. Choose **9:16 • Instagram Reel**. Pick **Fill frame** to crop to portrait, or **Fit** to keep the full scene with black bars.
4. (Optional) Pick background music. Type a title and set the title's global start/end time.
5. Click **Export MP4** and save. Use **Show export in Finder** to locate the finished, watermark-free file.
6. **Save** an editable project for later. Move neither the project source files nor soundtrack before reopening.

## Important limitations / scope

This is a source-code **starter app**, not a compiled or notarized, fully tested Mac installer. It's built and partially tested in a Linux development environment; macOS-specific GUI and DMG packaging must be tested on a real Mac. No automatic speech-to-text captions, transcription, animated captions, transitions, keyframes, overlays per clip, color grade, face tracking, or direct Instagram upload. Text overlays support a single title and depend on FFmpeg's `drawtext` filter and installed fonts (complex/emoji scripts may render differently). Browser preview approximates the final crop/text; it doesn't render the soundtrack or the exact speed until export. Some camera/video codecs may be exportable in FFmpeg but not preview in Electron, and HDR color handling isn't tuned. Cropping is center-based rather than tracking the face. Long videos/high resolutions can be CPU-intensive. The soundtrack gets looped to match the video.

**No-watermark** means ReelDesk adds none; if source footage already has another app's watermark, ReelDesk doesn't remove it.

## Technical details

The renderer has no Node.js privileges. Electron `contextIsolation` and sandbox are enabled, and import/export operations are exposed through a narrow validated preload bridge. Media filenames displayed in the app use `textContent`, not HTML. FFmpeg uses `spawn()` with an argument array (not shell interpolation); actual file paths in export are sourced from the native file picker or a chosen project JSON. Project files are intended for trusted, user-authored content.

### Test export engine

```bash
npm test
```

You can also test an end-to-end export using the integration test if FFmpeg is available. The integration test creates two tiny sample clips, including one silent clip, and exports a vertical video with title, speed changes, and music.

## License

MIT. This is independent software and not affiliated with Instagram, Edits or Meta. Check the FFmpeg/Homebrew build's third-party codec license terms before commercial redistribution or bundling FFmpeg inside a packaged app.
