'use strict';

const $ = id => document.getElementById(id);
const state = {
  clips: [], selected: -1, music: null, ratio: '9:16', mode: 'fit', resolution: 1080,
  musicVolume: 0.2, title: '', titleStart: 0, titleEnd: 4,
  titleColor: 'white', titlePosition: 'bottom', exporting: false, lastExport: null
};
const video = $('preview');

function duration(clip) { return (clip.end - clip.start) / clip.speed; }
function totalDuration() { return state.clips.reduce((sum, c) => sum + duration(c), 0); }
function timeLabel(seconds) {
  const n = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}
function selectedClip() { return state.clips[state.selected] || null; }
function setStatus(msg, error = false) {
  $('status').textContent = msg;
  $('status').style.color = error ? '#f2a29d' : '#8b9bb0';
}
function safeButton(label, action, title) {
  const btn = document.createElement('button'); btn.type = 'button';
  btn.textContent = label; btn.title = title; btn.addEventListener('click', e => { e.stopPropagation(); action(); });
  return btn;
}
function projectData() {
  return {
    clips: state.clips.map(c => ({ id: c.id, start: c.start, end: c.end, speed: c.speed })),
    musicId: state.music?.id || null, musicVolume: state.musicVolume,
    ratio: state.ratio, mode: state.mode, resolution: state.resolution,
    title: state.title, titleStart: state.titleStart, titleEnd: state.titleEnd,
    titleColor: state.titleColor, titlePosition: state.titlePosition
  };
}
function titleTime() {
  const c = selectedClip(); if (!c) return -1;
  let before = 0;
  for (let i = 0; i < state.selected; i++) before += duration(state.clips[i]);
  return before + (video.currentTime - c.start) / c.speed;
}
function updateOverlay() {
  const t = titleTime();
  $('textPreview').hidden = !(state.title.trim() && t >= state.titleStart && t <= state.titleEnd);
  $('textPreview').textContent = state.title;
  $('textPreview').style.color = { white: '#ffffff', yellow: '#ffff00', cyan: '#00ffff', black: '#000000' }[state.titleColor];
  $('textPreview').className = `overlay-text ${state.titlePosition === 'bottom' ? '' : state.titlePosition}`;
}
function setSelection(index) {
  if (index < 0 || index >= state.clips.length) index = -1;
  const changing = index !== state.selected;
  state.selected = index;
  const c = selectedClip();
  if (!c) {
    video.pause(); video.removeAttribute('src'); video.load(); video.style.display = 'none';
    $('emptyPreview').hidden = false;
    $('selectedHint').textContent = 'Choose a clip to adjust the trim.';
    $('trimStart').disabled = $('trimEnd').disabled = $('speed').disabled = true;
  } else {
    $('emptyPreview').hidden = true; video.style.display = 'block';
    if (changing || !video.getAttribute('src')) {
      video.pause(); video.src = c.url;
      video.load();
      video.addEventListener('loadedmetadata', () => { if (c === selectedClip()) { video.currentTime = c.start; updatePlayback(); } }, { once: true });
    }
    $('selectedHint').textContent = `${c.name} • ${c.width} × ${c.height}`;
    $('trimStart').disabled = $('trimEnd').disabled = $('speed').disabled = false;
    $('trimStart').value = Number(c.start.toFixed(2));
    $('trimEnd').value = Number(c.end.toFixed(2));
    $('trimEnd').max = c.duration;
    $('trimStart').max = c.duration;
    $('speed').value = String(c.speed);
  }
  renderClipList(); renderTimeline(); updatePlayback();
}
function renderClipList() {
  const list = $('clipList'); list.replaceChildren(); $('clipCount').textContent = state.clips.length;
  if (!state.clips.length) { const p = document.createElement('p'); p.className = 'muted small'; p.textContent = 'Your imported clips appear here.'; list.append(p); return; }
  state.clips.forEach((c, i) => {
    const card = document.createElement('div'); card.className = `clip-card ${i === state.selected ? 'selected' : ''}`;
    const art = document.createElement('div'); art.className = 'clip-art'; art.textContent = '▶';
    const info = document.createElement('div'); info.className = 'clip-info';
    const name = document.createElement('span'); name.className = 'clip-name'; name.textContent = c.name; name.title = c.name;
    const meta = document.createElement('div'); meta.className = 'clip-meta'; meta.textContent = `${timeLabel(duration(c))}  •  ${c.width}×${c.height}`;
    const tools = document.createElement('div'); tools.className = 'clip-tools';
    tools.append(
      safeButton('↑', () => moveClip(i, -1), 'Move earlier'),
      safeButton('↓', () => moveClip(i, 1), 'Move later'),
      safeButton('✕', () => removeClip(i), 'Remove clip')
    );
    info.append(name, meta, tools); card.append(art, info);
    card.addEventListener('click', () => setSelection(i)); list.append(card);
  });
}
function renderTimeline() {
  const view = $('timeline'); view.replaceChildren();
  $('totalDuration').textContent = `${timeLabel(totalDuration())} total`;
  if (!state.clips.length) { const div = document.createElement('div'); div.className = 'timeline-empty'; div.textContent = 'Your timeline is empty · Add clips to begin'; view.append(div); return; }
  state.clips.forEach((c, i) => {
    const item = document.createElement('button'); item.type = 'button';
    item.className = `timeline-clip ${i === state.selected ? 'active' : ''}`;
    const icon = document.createElement('div'); icon.textContent = '▤';
    const content = document.createElement('div'); const name = document.createElement('strong');
    name.textContent = `${i + 1}. ${c.name}`; const meta = document.createElement('span');
    meta.textContent = `${timeLabel(duration(c))} • ${c.speed}×`; content.append(name, meta);
    item.append(icon, content); item.addEventListener('click', () => setSelection(i)); view.append(item);
  });
}
function moveClip(index, amount) {
  const next = index + amount;
  if (next < 0 || next >= state.clips.length) return;
  const selectedId = selectedClip()?.id;
  [state.clips[index], state.clips[next]] = [state.clips[next], state.clips[index]];
  setSelection(state.clips.findIndex(c => c.id === selectedId));
  updateOverlay();
}
function removeClip(index) {
  const c = selectedClip(); const selectedId = c?.id;
  state.clips.splice(index, 1);
  const found = state.clips.findIndex(x => x.id === selectedId);
  const target = found < 0 ? Math.min(index, state.clips.length - 1) : found;
  // Refresh media even when selection index remains the same but its clip changed.
  state.selected = -1;
  setSelection(target);
  updateOverlay();
}
function updatePlayback() {
  const c = selectedClip();
  $('currentTime').textContent = c ? timeLabel(Math.max(0, video.currentTime - c.start)) : '00:00';
  $('endTime').textContent = c ? timeLabel(c.end - c.start) : '00:00';
  $('seek').value = c ? String(Math.max(0, Math.min(100, (video.currentTime - c.start) / (c.end - c.start) * 100))) : '0';
  $('playButton').textContent = video.paused ? '▶' : 'Ⅱ';
  updateOverlay();
}
function syncControls() {
  $('ratio').value = state.ratio; $('mode').value = state.mode; $('resolution').value = String(state.resolution);
  $('musicName').textContent = state.music?.name || 'No music selected';
  $('removeMusic').hidden = !state.music;
  $('musicVolume').value = String(Math.round(state.musicVolume * 100));
  $('musicVolumeLabel').textContent = `${Math.round(state.musicVolume * 100)}%`;
  $('titleText').value = state.title; $('titleStart').value = state.titleStart;
  $('titleEnd').value = state.titleEnd; $('titleColor').value = state.titleColor;
  $('titlePosition').value = state.titlePosition;
  applyFrame(); setSelection(state.selected >= 0 ? state.selected : (state.clips.length ? 0 : -1));
}
function applyFrame() {
  $('videoFrame').style.aspectRatio = state.ratio.replace(':', ' / ');
  video.style.objectFit = state.mode === 'crop' ? 'cover' : 'contain';
}
async function importVideos() {
  try {
    const imported = await window.reeldesk.chooseVideos();
    if (!imported.length) return;
    const startingLength = state.clips.length;
    state.clips.push(...imported.map(c => ({ ...c, start: 0, end: c.duration, speed: 1 })));
    if (state.clips.length > 50) state.clips.length = 50;
    setSelection(startingLength < 50 ? startingLength : 0);
    setStatus(`${imported.length} clip(s) imported • Use ↑ ↓ to reorder`);
  } catch (err) { setStatus(err.message, true); }
}
function editTrim(which, value) {
  const c = selectedClip(); if (!c) return;
  const parsed = Number(value); if (!Number.isFinite(parsed)) return;
  if (which === 'start') c.start = Math.max(0, Math.min(c.end - 0.05, parsed));
  else c.end = Math.max(c.start + 0.05, Math.min(c.duration, parsed));
  $('trimStart').value = Number(c.start.toFixed(2)); $('trimEnd').value = Number(c.end.toFixed(2));
  if (video.currentTime < c.start || video.currentTime > c.end) video.currentTime = c.start;
  renderClipList(); renderTimeline(); updatePlayback();
}
async function exportVideo() {
  if (state.exporting) return;
  if (!state.clips.length) { setStatus('Import a video clip first', true); return; }
  state.exporting = true; state.lastExport = null;
  $('exportButton').disabled = true;
  $('progressContainer').hidden = false; $('progressFill').style.width = '0%'; $('progressPercent').textContent = '0%';
  $('revealButton').hidden = true;
  setStatus('Choose where to save your MP4…');
  try {
    const result = await window.reeldesk.exportVideo(projectData());
    if (result.cancelled) setStatus('Export dialog dismissed');
    else { state.lastExport = result.path; $('revealButton').hidden = false; setStatus('Export complete ✓ • Video saved without a watermark'); }
  } catch (err) { setStatus(err.message.length > 200 ? `${err.message.slice(0, 200)}…` : err.message, true); }
  finally { state.exporting = false; $('progressContainer').hidden = true; $('exportButton').disabled = false; }
}
function updateExportProgress(pct) {
  if (!state.exporting) return;
  $('progressFill').style.width = `${pct}%`; $('progressPercent').textContent = `${pct}%`;
  setStatus(`Rendering final video… ${pct}%`);
}
async function saveProject() {
  try { const saved = await window.reeldesk.saveProject(projectData()); if (saved) setStatus('Editable project saved ✓'); }
  catch (err) { setStatus(err.message, true); }
}
async function openProject() {
  try {
    const project = await window.reeldesk.openProject(); if (!project) return;
    Object.assign(state, { clips: project.clips, music: project.music, ratio: project.ratio || '9:16',
      mode: project.mode || 'fit', resolution: Number(project.resolution || 1080),
      musicVolume: Number(project.musicVolume ?? 0.2), title: project.title || '',
      titleStart: Number(project.titleStart || 0), titleEnd: Number(project.titleEnd ?? 4),
      titleColor: project.titleColor || 'white', titlePosition: project.titlePosition || 'bottom', selected: -1 });
    syncControls(); setStatus('Project loaded ✓');
  } catch (err) { setStatus(err.message, true); }
}

$('importButton').addEventListener('click', importVideos);
$('emptyImport').addEventListener('click', importVideos);
$('addToTimeline').addEventListener('click', importVideos);
$('exportButton').addEventListener('click', exportVideo);
$('saveProject').addEventListener('click', saveProject);
$('openProject').addEventListener('click', openProject);
$('musicButton').addEventListener('click', async () => {
  try { const music = await window.reeldesk.chooseMusic(); if (music) { state.music = music; syncControls(); setStatus('Music selected • It will play in the export'); } }
  catch (err) { setStatus(err.message, true); }
});
$('removeMusic').addEventListener('click', () => { state.music = null; syncControls(); });
$('musicVolume').addEventListener('input', e => { state.musicVolume = Number(e.target.value) / 100; $('musicVolumeLabel').textContent = `${e.target.value}%`; });
$('playButton').addEventListener('click', async () => {
  const c = selectedClip(); if (!c) return;
  if (video.paused) { if (video.currentTime >= c.end - 0.05) video.currentTime = c.start;
    try { await video.play(); } catch { setStatus('This codec may not preview in Electron; export may still work', true); } }
  else video.pause();
  updatePlayback();
});
video.addEventListener('timeupdate', () => { const c = selectedClip(); if (c && video.currentTime >= c.end) { video.pause(); video.currentTime = c.end; } updatePlayback(); });
video.addEventListener('pause', updatePlayback);
video.addEventListener('play', updatePlayback);
video.addEventListener('error', () => { if (selectedClip()) setStatus('Preview unavailable for this codec; try an MP4/H.264 clip', true); });
$('seek').addEventListener('input', e => {
  const c = selectedClip(); if (!c) return;
  video.currentTime = c.start + Number(e.target.value) / 100 * (c.end - c.start);
  updatePlayback();
});
$('trimStart').addEventListener('change', e => editTrim('start', e.target.value));
$('trimEnd').addEventListener('change', e => editTrim('end', e.target.value));
$('speed').addEventListener('change', e => { const c = selectedClip(); if (!c) return; c.speed = Number(e.target.value); renderTimeline(); renderClipList(); updateOverlay(); });
$('ratio').addEventListener('change', e => { state.ratio = e.target.value; applyFrame(); });
$('mode').addEventListener('change', e => { state.mode = e.target.value; applyFrame(); });
$('resolution').addEventListener('change', e => { state.resolution = Number(e.target.value); });
$('titleText').addEventListener('input', e => { state.title = e.target.value; updateOverlay(); });
$('titleStart').addEventListener('change', e => { state.titleStart = Number(e.target.value); updateOverlay(); });
$('titleEnd').addEventListener('change', e => { state.titleEnd = Number(e.target.value); updateOverlay(); });
$('titleColor').addEventListener('change', e => { state.titleColor = e.target.value; updateOverlay(); });
$('titlePosition').addEventListener('change', e => { state.titlePosition = e.target.value; updateOverlay(); });
$('cancelExport').addEventListener('click', async () => { if (state.exporting) { setStatus('Cancelling export…'); await window.reeldesk.cancelExport(); } });
$('revealButton').addEventListener('click', () => { if (state.lastExport) window.reeldesk.revealExport(state.lastExport); });
window.reeldesk.onExportProgress(updateExportProgress);
document.addEventListener('keydown', e => {
  if (e.code === 'Space' && !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(document.activeElement?.tagName)) {
    e.preventDefault(); $('playButton').click();
  }
});
syncControls();
