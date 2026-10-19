'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Timeline = require('./timeline');

const RATIOS = Object.freeze({
  '9:16': [9, 16],
  '4:5': [4, 5],
  '1:1': [1, 1],
  '16:9': [16, 9]
});
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const COLORS = ['white', 'yellow', 'cyan', 'black'];
const POSITIONS = ['top', 'middle', 'bottom'];

function findBinary(name) {
  const candidates = [
    process.env[name.toUpperCase() + '_PATH'],
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
    name
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate === name || fs.existsSync(candidate)) return candidate;
  }
  return name;
}

function capture(binary, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', data => { stdout += data.toString(); if (stdout.length > 1024 * 1024) child.kill(); });
    child.stderr.on('data', data => { stderr += data.toString().slice(-2048); });
    child.once('error', err => reject(new Error(`${binary}: ${err.message}. Install FFmpeg using: brew install ffmpeg`)));
    child.once('close', code => code === 0 ? resolve(stdout) : reject(new Error(`${path.basename(binary)} exited ${code}: ${stderr.slice(-1200)}`)));
  });
}

async function probeFile(filepath) {
  const output = await capture(findBinary('ffprobe'), [
    '-v', 'error', '-show_entries', 'format=duration:stream=index,codec_type,width,height,duration',
    '-of', 'json', filepath
  ]);
  const data = JSON.parse(output);
  const streams = data.streams || [];
  const video = streams.find(s => s.codec_type === 'video');
  if (!video) throw new Error('No usable video track found');
  const duration = Number(data.format?.duration || video.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Video duration is missing');
  return { duration, width: video.width, height: video.height, hasAudio: streams.some(s => s.codec_type === 'audio') };
}

function fixed(value) { return Number(value).toFixed(4); }
function safeFilterPath(filepath) {
  // FFmpeg filtergraph escaping, for paths which are controlled temp files.
  return filepath.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "'\\\\\\''").replace(/,/g, '\\,').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}
function dimensions(ratio, resolution) {
  const pair = RATIOS[ratio];
  if (!pair) throw new Error('Invalid aspect ratio');
  if (![720, 1080, 2160].includes(resolution)) throw new Error('Invalid export size');
  const [a, b] = pair;
  // "resolution" denotes width for portrait, height for landscape.
  const scale = resolution / Math.min(a, b);
  const w = Math.round((a * scale) / 2) * 2;
  const h = Math.round((b * scale) / 2) * 2;
  return { width: w, height: h };
}

function bounded(value, fallback, min, max, name) {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n) || n < min || n > max) throw Error(`Invalid ${name}`);
  return n;
}
function audioSettings(c) {
  return { volume: bounded(c.volume, 1, 0, 2, 'volume'), fadeIn: bounded(c.fadeIn, 0, 0, 30, 'fade in'), fadeOut: bounded(c.fadeOut, 0, 0, 30, 'fade out') };
}
function gainAndFades(c, length) {
  const fadeIn = Math.min(c.fadeIn || 0, length / 2), fadeOut = Math.min(c.fadeOut || 0, length / 2);
  return `volume=${fixed(c.volume ?? 1)}` + (fadeIn ? `,afade=t=in:st=0:d=${fixed(fadeIn)}` : '') + (fadeOut ? `,afade=t=out:st=${fixed(length - fadeOut)}:d=${fixed(fadeOut)}` : '');
}
function normalizeProject(project, assetMap) {
  if (!project || !Array.isArray(project.clips) || project.clips.length < 1 || project.clips.length > 50) {
    throw new Error('Add 1–50 clips before exporting');
  }
  const ratio = project.ratio || '9:16';
  const mode = project.mode || 'fit';
  const resolution = Number(project.resolution || 1080);
  const { width, height } = dimensions(ratio, resolution);
  if (!['fit', 'crop'].includes(mode)) throw new Error('Invalid frame mode');
  const clips = project.clips.map(c => {
    const media = assetMap.get(c.id);
    if (!media || !['video', 'image'].includes(media.type)) throw new Error('A clip is no longer available. Please import it again.');
    if (!fs.existsSync(media.path)) throw new Error(`Missing clip: ${media.name}`);
    const start = Number(c.start), end = Number(c.end), speed = Number(c.speed);
    if (![start, end, speed].every(Number.isFinite) || start < 0 || end - start < 0.05 ||
        end > (media.type === 'image' ? 3600 : media.duration) + 0.000001 || !SPEEDS.includes(speed)) {
      throw new Error(`Invalid trim/speed for ${media.name}`);
    }
    const safeEnd = media.type === 'image' ? end : Math.min(end, media.duration);
    if (safeEnd - start < 0.05 || (media.type === 'image' && speed !== 1)) throw new Error('Invalid clip duration');
    return { ...media, ...audioSettings(c), transition: c.transition, start, end: safeEnd, speed, adjustedDuration: (safeEnd - start) / speed };
  });
  const layout = Timeline.layout(clips);
  const duration = Timeline.total(clips);
  if (duration > 3600) throw new Error('Maximum supported project duration is 60 minutes');
  let music = null;
  if (project.musicId) {
    music = assetMap.get(project.musicId);
    if (!music || music.type !== 'music' || !fs.existsSync(music.path)) throw new Error('Soundtrack is missing');
  }
  const musicVolume = Number(project.musicVolume ?? 0.2);
  if (!Number.isFinite(musicVolume) || musicVolume < 0 || musicVolume > 1) throw new Error('Music volume must be 0–1');
  const tracks = project.audioTracks ?? [];
  if (!Array.isArray(tracks) || tracks.length > 8) throw Error('Use up to 8 additional audio tracks');
  const audioTracks = tracks.map(track => {
    const media = assetMap.get(track.id);
    if (!media || media.type !== 'music' || !fs.existsSync(media.path)) throw Error('Audio track is missing');
    const sourceDuration = Number(media.duration);
    if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) throw Error('Audio duration is unavailable; import the track again');
    const trimStart = bounded(track.trimStart, 0, 0, sourceDuration, 'audio trim start');
    const trimEnd = bounded(track.trimEnd, sourceDuration, 0, sourceDuration, 'audio trim end');
    if (trimEnd - trimStart < 0.05) throw Error('Audio trim must leave at least 0.05 seconds');
    const start = bounded(track.start, 0, 0, 3600, 'audio timeline start');
    if (track.loop !== undefined && typeof track.loop !== 'boolean') throw Error('Invalid audio loop');
    return { ...media, ...audioSettings(track), trimStart, trimEnd, start, loop: track.loop === true };
  });
  const musicFades = { fadeIn: bounded(project.musicFadeIn, 0, 0, 30, 'music fade in'), fadeOut: bounded(project.musicFadeOut, 0, 0, 30, 'music fade out') };
  const title = String(project.title || '').slice(0, 160).trim();
  const titleStart = Number(project.titleStart ?? 0);
  const requestedTitleEnd = Number(project.titleEnd ?? Math.min(4, duration));
  const titleEnd = Math.min(duration, requestedTitleEnd);
  const titleColor = project.titleColor || 'white';
  const titlePosition = project.titlePosition || 'bottom';
  if (!COLORS.includes(titleColor) || !POSITIONS.includes(titlePosition)) throw new Error('Invalid title appearance');
  if (title && (![titleStart, requestedTitleEnd].every(Number.isFinite) || titleStart < 0 || titleEnd < titleStart || titleStart > duration)) {
    throw new Error('Title timings must fall within the final video');
  }
  return { clips, layout, audioTracks, musicFades, music, musicVolume, title, titleStart, titleEnd, titleColor, titlePosition,
    width, height, ratio, resolution, mode, duration };
}

function findFont() {
  return [
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/Library/Fonts/Arial.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
  ].find(f => fs.existsSync(f));
}

function makeArgs(project, outputPath, textFilePath) {
  const args = ['-hide_banner', '-y'];
  for (const c of project.clips) {
    if (c.type === 'image') args.push('-loop', '1', '-framerate', '30');
    args.push('-i', c.path);
  }
  if (project.music) args.push('-stream_loop', '-1', '-i', project.music.path);
  for (const track of project.audioTracks || []) args.push('-i', track.path);
  const filters = [];
  project.clips.forEach((clip, i) => {
    const dur = fixed(clip.adjustedDuration);
    const scale = `scale=${project.width}:${project.height}:force_original_aspect_ratio=${project.mode === 'crop' ? 'increase' : 'decrease'}`;
    const frame = project.mode === 'crop'
      ? `crop=${project.width}:${project.height}`
      : `pad=${project.width}:${project.height}:(ow-iw)/2:(oh-ih)/2:black`;
    filters.push(`[${i}:v:0]trim=start=${fixed(clip.start)}:end=${fixed(clip.end)},setpts=(PTS-STARTPTS)/${fixed(clip.speed)},${scale},${frame},setsar=1,fps=30,format=yuv420p,trim=duration=${dur},setpts=PTS-STARTPTS,settb=AVTB[v${i}]`);
    const audioFilters = `aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,apad,atrim=duration=${dur},asetpts=PTS-STARTPTS,${gainAndFades(clip, clip.adjustedDuration)}[a${i}]`;
    if (clip.hasAudio) {
      filters.push(`[${i}:a:0]atrim=start=${fixed(clip.start)}:end=${fixed(clip.end)},asetpts=PTS-STARTPTS,atempo=${fixed(clip.speed)},${audioFilters}`);
    } else {
      filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${dur},asetpts=PTS-STARTPTS,${gainAndFades(clip, clip.adjustedDuration)}[a${i}]`);
    }
  });
  let videoTag = '[v0]', audioTag = '[a0]';
  const layout = project.layout || Timeline.layout(project.clips);
  for (let i = 1; i < project.clips.length; i++) {
    const boundary = layout[i - 1];
    if (boundary.overlap) {
      filters.push(`${videoTag}[v${i}]xfade=transition=${boundary.type}:duration=${fixed(boundary.overlap)}:offset=${fixed(layout[i].start)}[vjoin${i}]`);
      filters.push(`${audioTag}[a${i}]acrossfade=d=${fixed(boundary.overlap)}:c1=tri:c2=tri[ajoin${i}]`);
    } else {
      filters.push(`${videoTag}[v${i}]concat=n=2:v=1:a=0,settb=AVTB[vjoin${i}]`);
      filters.push(`${audioTag}[a${i}]concat=n=2:v=0:a=1[ajoin${i}]`);
    }
    videoTag = `[vjoin${i}]`; audioTag = `[ajoin${i}]`;
  }
  if (project.title && project.titleEnd > project.titleStart) {
    const font = findFont();
    const fontSelector = font ? `fontfile='${safeFilterPath(font)}'` : 'font=Sans';
    const y = project.titlePosition === 'top' ? 'h*0.12'
      : project.titlePosition === 'middle' ? '(h-text_h)/2'
      : 'h-text_h-h*0.13';
    const size = Math.round(project.width * 0.057);
    const draw = `drawtext=${fontSelector}:textfile='${safeFilterPath(textFilePath)}':fontcolor=${project.titleColor}:fontsize=${size}:x=(w-text_w)/2:y=${y}:box=1:boxcolor=black@0.55:boxborderw=${Math.round(size * 0.28)}:enable='between(t\\,${fixed(project.titleStart)}\\,${fixed(project.titleEnd)})'`;
    filters.push(`${videoTag}${draw}[vtitle]`);
    videoTag = '[vtitle]';
  }
  if (project.music) {
    const index = project.clips.length;
    filters.push(`[${index}:a:0]atrim=duration=${fixed(project.duration)},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,${gainAndFades({ volume: project.musicVolume, ...project.musicFades }, project.duration)}[bg]`);
    filters.push(`${audioTag}[bg]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95:level=0:latency=1[aout]`);
    audioTag = '[aout]';
  }
  const trackTags = [];
  (project.audioTracks || []).forEach((track, i) => {
    // A track beyond the end remains editable but contributes no samples to this export.
    if (track.start >= project.duration) return;
    const index = project.clips.length + (project.music ? 1 : 0) + i;
    const length = Math.min(project.duration - track.start, track.loop ? Infinity : track.trimEnd - track.trimStart);
    const loop = track.loop ? `,aloop=loop=-1:size=${Math.max(1, Math.round((track.trimEnd - track.trimStart) * 48000))}` : '';
    filters.push(`[${index}:a:0]atrim=start=${fixed(track.trimStart)}:end=${fixed(track.trimEnd)},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo${loop},atrim=duration=${fixed(length)},${gainAndFades(track, length)},adelay=${Math.round(track.start * 1000)}:all=1[track${i}]`);
    trackTags.push(`[track${i}]`);
  });
  if (trackTags.length) {
    filters.push(`${audioTag}${trackTags.join('')}amix=inputs=${trackTags.length + 1}:duration=first:normalize=0,alimiter=limit=0.95:level=0:latency=1[amixed]`);
    audioTag = '[amixed]';
  }
  args.push('-filter_complex', filters.join(';'), '-map', videoTag, '-map', audioTag,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p',
    '-r', '30', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
    '-t', fixed(project.duration), '-progress', 'pipe:2', '-nostats', outputPath);
  return args;
}

function runExport(project, outputPath, onProgress = () => {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'reeldesk-'));
  const textPath = path.join(temp, 'title.txt');
  fs.writeFileSync(textPath, project.title || '', 'utf8');
  const args = makeArgs(project, outputPath, textPath);
  const child = spawn(findBinary('ffmpeg'), args, { windowsHide: true });
  let settled = false;
  let stderr = '';
  let chunk = '';
  let cancelled = false;
  const clean = () => { try { fs.rmSync(temp, { recursive: true, force: true }); } catch { /* ignore */ } };
  const promise = new Promise((resolve, reject) => {
    child.stderr.on('data', data => {
      const str = data.toString();
      stderr = (stderr + str).slice(-9000);
      chunk += str;
      const lines = chunk.split(/\r?\n/);
      chunk = lines.pop() || '';
      for (const line of lines) {
        const match = line.match(/^out_time_(?:ms|us)=(\d+)/);
        if (match) {
          const progress = Math.max(0, Math.min(99, Number(match[1]) / (project.duration * 1e6) * 100));
          onProgress(Math.round(progress));
        }
      }
    });
    child.once('error', err => {
      if (settled) return;
      settled = true; clean();
      reject(new Error(`Could not launch FFmpeg: ${err.message}. Try brew install ffmpeg`));
    });
    child.once('close', code => {
      if (settled) return;
      settled = true; clean();
      if (code === 0 && !cancelled) { onProgress(100); resolve(outputPath); }
      else { try { fs.rmSync(outputPath, { force: true }); } catch { /* ignore */ }
        reject(new Error(cancelled ? 'Export cancelled' : `Export failed (${code}): ${stderr.slice(-1800)}`)); }
    });
  });
  return { promise, cancel: () => { cancelled = true; if (child.exitCode === null) child.kill('SIGTERM'); } };
}

module.exports = { RATIOS, SPEEDS, findBinary, capture, probeFile, dimensions, normalizeProject, makeArgs, runExport };
