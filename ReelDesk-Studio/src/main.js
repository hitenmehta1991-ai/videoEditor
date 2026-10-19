'use strict';

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const crypto = require('node:crypto');
const os = require('node:os');
const { importMedia, cleanup } = require('./media');
const { capture, findBinary, normalizeProject, runExport } = require('./exporter');

let mainWindow = null;
let currentExport = null;
const assets = new Map();
const previewDirs = [];
async function audioAsset(filepath) {
  const data = JSON.parse(await capture(findBinary('ffprobe'), ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,duration', '-of', 'json', filepath]));
  const stream = data.streams?.find(s => s.codec_type === 'audio');
  const duration = Number(data.format?.duration || stream?.duration);
  if (!stream || !Number.isFinite(duration) || duration <= 0) throw Error('This file has no usable audio track');
  return recordAsset(filepath, { duration }, 'music');
}

function assertCaller(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Untrusted application request');
}
function safeName(file) { return path.basename(file); }
function assertSavedProject(obj) {
  if (!obj || obj.format !== 'reeldesk-project' || !Array.isArray(obj.clips) || obj.clips.length > 50) {
    throw new Error('Not a ReelDesk project');
  }
}
function recordAsset(filePath, meta, type = 'video') {
  const id = crypto.randomUUID();
  const entry = { id, name: safeName(filePath), path: filePath, type, ...meta };
  assets.set(id, entry);
  return { id, name: entry.name, type, thumbnails: entry.thumbnails || [], url: type !== 'music' ? pathToFileURL(entry.previewPath || filePath).href : undefined,
    duration: entry.duration, width: entry.width, height: entry.height, hasAudio: entry.hasAudio };
}

function setupIPC() {
  ipcMain.handle('choose-videos', async e => {
    assertCaller(e);
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: 'Import videos and images', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Video clips', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'] }]
    });
    if (selection.canceled) return [];
    const clips = [];
    const errors = [];
    for (const file of selection.filePaths.slice(0, 50)) {
      try { const media = await importMedia(file); clips.push(recordAsset(file, media, media.type)); }
      catch (err) { errors.push(`${safeName(file)}: ${err.message}`); }
    }
    if (errors.length) dialog.showMessageBox(mainWindow, { type: 'warning', title: 'Some files could not be imported', message: errors.join('\n').slice(0, 1800) });
    return clips;
  });
  ipcMain.handle('drop-media', async (e, paths) => {
    assertCaller(e);
    if (!Array.isArray(paths) || paths.length > 50 || paths.some(p => typeof p !== 'string')) throw Error('Drop up to 50 media files');
    const result = [];
    for (const file of paths) { const media = await importMedia(file); result.push(recordAsset(file, media, media.type)); }
    return result;
  });
  ipcMain.handle('choose-music', async e => {
    assertCaller(e);
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose background music', properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'm4a', 'wav', 'aac', 'flac', 'ogg'] }]
    });
    if (selection.canceled || !selection.filePaths[0]) return null;
    const filepath = selection.filePaths[0];
    return audioAsset(filepath);
  });
  ipcMain.handle('save-project', async (e, project) => {
    assertCaller(e);
    if (!project || !Array.isArray(project.clips) || project.clips.length > 50) throw new Error('Invalid project');
    const dialogResult = await dialog.showSaveDialog(mainWindow, {
      title: 'Save editable ReelDesk project', defaultPath: 'My Reel.reeldesk.json',
      filters: [{ name: 'ReelDesk project', extensions: ['json'] }]
    });
    if (dialogResult.canceled || !dialogResult.filePath) return null;
    const clips = project.clips.map(c => {
      const asset = assets.get(c.id);
      if (!asset || !['video', 'image'].includes(asset.type)) throw new Error('Project refers to an unavailable clip');
      return { path: asset.originalPath || asset.path, type: asset.type, start: c.start, end: c.end, speed: c.speed, transition: c.transition, volume: c.volume, fadeIn: c.fadeIn, fadeOut: c.fadeOut };
    });
    const music = project.musicId ? assets.get(project.musicId) : null;
    if (project.musicId && (!music || music.type !== 'music')) throw new Error('Project soundtrack is unavailable');
    if (project.audioTracks && (!Array.isArray(project.audioTracks) || project.audioTracks.length > 8)) throw Error('Use up to 8 additional audio tracks');
    const audioTracks = (project.audioTracks || []).map(track => {
      const asset = assets.get(track.id);
      if (!asset || asset.type !== 'music') throw Error('Audio track is unavailable');
      const { id, ...edit } = track;
      return { ...edit, path: asset.path };
    });
    const payload = { format: 'reeldesk-project', version: 3, savedAt: new Date().toISOString(),
      ...project, clips, audioTracks, musicPath: music?.path || null };
    delete payload.musicId;
    fs.writeFileSync(dialogResult.filePath, JSON.stringify(payload, null, 2), 'utf8');
    return dialogResult.filePath;
  });
  ipcMain.handle('open-project', async e => {
    assertCaller(e);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open ReelDesk project', properties: ['openFile'],
      filters: [{ name: 'ReelDesk project', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const data = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
    assertSavedProject(data);
    const clips = [];
    for (const c of data.clips) {
      if (typeof c.path !== 'string' || !fs.existsSync(c.path)) throw new Error(`Missing project video: ${String(c.path)}`);
      const media = await importMedia(c.path);
      clips.push({ ...recordAsset(c.path, media, media.type), start: c.start, end: c.end, speed: c.speed, transition: c.transition, volume: c.volume, fadeIn: c.fadeIn, fadeOut: c.fadeOut });
    }
    let music = null;
    if (data.musicPath) {
      if (!fs.existsSync(data.musicPath)) throw new Error('Project background music file is missing');
      music = await audioAsset(data.musicPath);
    }
    if (data.audioTracks && (!Array.isArray(data.audioTracks) || data.audioTracks.length > 8)) throw Error('Invalid audio tracks');
    const audioTracks = [];
    for (const track of data.audioTracks || []) {
      if (typeof track.path !== 'string' || !fs.existsSync(track.path)) throw Error('Project audio file is missing');
      const media = await audioAsset(track.path);
      audioTracks.push({ ...media, start: track.start, trimStart: track.trimStart, trimEnd: track.trimEnd, volume: track.volume, fadeIn: track.fadeIn, fadeOut: track.fadeOut, loop: track.loop });
    }
    return { clips, music, audioTracks, musicFadeIn: data.musicFadeIn, musicFadeOut: data.musicFadeOut, ratio: data.ratio, mode: data.mode, resolution: data.resolution,
      musicVolume: data.musicVolume, title: data.title, titleStart: data.titleStart, titleEnd: data.titleEnd,
      titlePosition: data.titlePosition, titleColor: data.titleColor };
  });
  ipcMain.handle('export-video', async (e, project) => {
    assertCaller(e);
    if (currentExport) throw new Error('An export is already running');
    const normalized = normalizeProject(project, assets);
    const saveResult = await dialog.showSaveDialog(mainWindow, {
      title: 'Export watermark-free MP4', defaultPath: 'My Reel.mp4',
      filters: [{ name: 'MP4 video', extensions: ['mp4'] }]
    });
    if (saveResult.canceled || !saveResult.filePath) return { cancelled: true };
    const output = saveResult.filePath;
    if (normalized.clips.some(c => (c.path === output || c.originalPath === output)) || normalized.music?.path === output || normalized.audioTracks.some(track => track.path === output)) {
      throw new Error('Choose an output path different from your source files');
    }
    // The child process uses argument arrays, not shell commands.
    currentExport = runExport(normalized, output, progress => {
      if (!mainWindow?.isDestroyed()) mainWindow.webContents.send('export-progress', progress);
    });
    try {
      await currentExport.promise;
      return { cancelled: false, path: output };
    } finally { currentExport = null; }
  });
  ipcMain.handle('preview-sequence', async (e, project) => {
    assertCaller(e);
    if (currentExport) throw Error('A render is already running');
    const normalized = normalizeProject({ ...project, resolution: 720 }, assets);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reeldesk-preview-')); previewDirs.push(dir);
    const output = path.join(dir, 'preview.mp4');
    currentExport = runExport(normalized, output, progress => {
      if (!mainWindow?.isDestroyed()) mainWindow.webContents.send('export-progress', progress);
    });
    try {
      await currentExport.promise;
      while (previewDirs.length > 2) fs.rmSync(previewDirs.shift(), { recursive: true, force: true });
      return pathToFileURL(output).href;
    } catch (err) {
      fs.rmSync(dir, { recursive: true, force: true }); previewDirs.splice(previewDirs.indexOf(dir), 1); throw err;
    }
    finally { currentExport = null; }
  });
  ipcMain.handle('cancel-export', e => {
    assertCaller(e);
    if (currentExport) currentExport.cancel();
    return Boolean(currentExport);
  });
  ipcMain.handle('reveal-export', (e, filepath) => {
    assertCaller(e);
    if (typeof filepath !== 'string' || !filepath.endsWith('.mp4')) return;
    shell.showItemInFolder(filepath);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'ReelDesk Studio', width: 1460, height: 920, minWidth: 1060, minHeight: 670,
    backgroundColor: '#0b1019',
    webPreferences: { preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true }
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', e => e.preventDefault());
}

app.whenReady().then(() => {
  setupIPC();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('before-quit', () => { if (currentExport) currentExport.cancel(); });
app.on('will-quit', () => { cleanup(); for (const dir of previewDirs) fs.rmSync(dir, { recursive: true, force: true }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
