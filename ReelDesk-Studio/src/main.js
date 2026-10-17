'use strict';

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const crypto = require('node:crypto');
const { importMedia, cleanup } = require('./media');
const { capture, findBinary, normalizeProject, runExport } = require('./exporter');

let mainWindow = null;
let currentExport = null;
const assets = new Map();

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
    const probe = JSON.parse(await capture(findBinary('ffprobe'), ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', filepath]));
    if (!probe.streams?.some(s => s.codec_type === 'audio')) throw new Error('This file has no audio track');
    return recordAsset(filepath, {}, 'music');
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
      return { path: asset.originalPath || asset.path, type: asset.type, start: c.start, end: c.end, speed: c.speed };
    });
    const music = project.musicId ? assets.get(project.musicId) : null;
    if (project.musicId && (!music || music.type !== 'music')) throw new Error('Project soundtrack is unavailable');
    const payload = { format: 'reeldesk-project', version: 2, savedAt: new Date().toISOString(),
      ...project, clips, musicPath: music?.path || null };
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
      clips.push({ ...recordAsset(c.path, media, media.type), start: c.start, end: c.end, speed: c.speed });
    }
    let music = null;
    if (data.musicPath) {
      if (!fs.existsSync(data.musicPath)) throw new Error('Project background music file is missing');
      music = recordAsset(data.musicPath, {}, 'music');
    }
    return { clips, music, ratio: data.ratio, mode: data.mode, resolution: data.resolution,
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
    if (normalized.clips.some(c => (c.path === output || c.originalPath === output)) || normalized.music?.path === output) {
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
app.on('will-quit', cleanup);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
