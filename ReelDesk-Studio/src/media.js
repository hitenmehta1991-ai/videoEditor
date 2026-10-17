'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { capture, findBinary, probeFile } = require('./exporter');
const IMAGE = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);
const VIDEO = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi']);
const cache = new Map();
let temp;
function cacheDir() { return temp ||= fs.mkdtempSync(path.join(os.tmpdir(), 'reeldesk-media-')); }
async function load(file) {
  const ext = path.extname(file).toLowerCase();
  if (!IMAGE.has(ext) && !VIDEO.has(ext)) throw Error('Unsupported media file');
  const originalPath = file;
  const type = IMAGE.has(ext) ? 'image' : 'video';
  if (ext === '.heic' || ext === '.heif') {
    if (process.platform !== 'darwin') throw Error('HEIC import currently requires macOS');
    file = path.join(cacheDir(), `${cache.size}-converted.png`);
    await capture('/usr/bin/sips', ['-s', 'format', 'png', originalPath, '--out', file]);
  }
  let meta;
  if (type === 'image') {
    const data = JSON.parse(await capture(findBinary('ffprobe'), ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'json', file]));
    const stream = data.streams?.find(s => s.width && s.height);
    if (!stream) throw Error('Image cannot be decoded');
    meta = { ...stream, duration: 5, hasAudio: false };
  } else meta = await probeFile(file);
  const thumbnails = [];
  for (const fraction of type === 'image' ? [0] : [0, 0.33, 0.66]) {
    const out = path.join(cacheDir(), `${cache.size}-${fraction}-${Date.now()}.jpg`);
    try {
      await capture(findBinary('ffmpeg'), ['-v', 'error', '-y', '-ss', String(meta.duration * fraction), '-i', file, '-frames:v', '1', '-vf', 'scale=160:90:force_original_aspect_ratio=decrease,pad=160:90:(ow-iw)/2:(oh-ih)/2', out]);
      thumbnails.push(`data:image/jpeg;base64,${fs.readFileSync(out).toString('base64')}`);
    } catch (err) { if (type === 'image') throw err; /* Video can still export without a preview. */ }
  }
  return { ...meta, type, originalPath, path: file, previewPath: file, thumbnails };
}
async function importMedia(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw Error('Import a media file');
  const key = `${file}:${stat.size}:${stat.mtimeMs}`;
  if (!cache.has(key)) { const pending = load(file); cache.set(key, pending); pending.catch(() => cache.delete(key)); }
  return cache.get(key);
}
function cleanup() { if (temp) fs.rmSync(temp, { recursive: true, force: true }); temp = undefined; cache.clear(); }
module.exports = { importMedia, cleanup };
