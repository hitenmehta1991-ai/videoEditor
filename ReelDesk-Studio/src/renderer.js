'use strict';

const $ = id => document.getElementById(id);
const state = {
  clips: [], selected: -1, music: null, ratio: '9:16', mode: 'fit', resolution: 1080,
  musicVolume: 0.2, title: '', titleStart: 0, titleEnd: 4,
  titleColor: 'white', titlePosition: 'bottom', exporting: false, lastExport: null
};
const video = $('preview');
const history = new Timeline.History();
let pixelsPerSecond = 40;
let imageTime = 0;
let imagePlaying = false;
let dragIndex = null;
function snapshot() {
  const { exporting, lastExport, ...editable } = state;
  return structuredClone(editable);
}
function checkpoint() { history.push(snapshot()); updateHistory(); }
function updateHistory() { $('undo').disabled = !history.past.length; $('redo').disabled = !history.future.length; }
function restore(direction) {
  const saved = history[direction](snapshot()); if (!saved) return;
  video.pause(); imagePlaying = false; Object.assign(state, saved);
  const target = state.selected; state.selected = -1; setSelection(target); syncControls(); updateHistory();
}
function localTime() { const c = selectedClip(); return !c ? 0 : c.type === 'image' ? imageTime : (video.currentTime - c.start) / c.speed; }
function seekLocal(time) { const c = selectedClip(); if (!c) return; const t = Math.max(0, Math.min(duration(c), time)); if (c.type === 'image') imageTime = t; else video.currentTime = c.start + t * c.speed; updatePlayback(); }


function duration(clip) { return Timeline.duration(clip); }
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
  return before + localTime();
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
  if (changing) { imagePlaying = false; imageTime = 0; }
  state.selected = index;
  const c = selectedClip();
  $('imagePreview').hidden = !c || c.type !== 'image';
  $('imageDuration').hidden = $('imageDurationLabel').hidden = !c || c.type !== 'image';
  if (!c) {
    video.pause(); video.removeAttribute('src'); video.load(); video.style.display = 'none';
    $('emptyPreview').hidden = false;
    $('selectedHint').textContent = 'Choose a clip to adjust the trim.';
    $('trimStart').disabled = $('trimEnd').disabled = $('speed').disabled = true;
  } else {
    $('emptyPreview').hidden = true; video.style.display = c.type === 'image' ? 'none' : 'block';
    $('imagePreview').src = c.type === 'image' ? c.url : '';
    $('imageDuration').value = duration(c);
    if (c.type === 'image') video.pause();
    if (c.type !== 'image' && (changing || video.getAttribute('src') !== c.url)) {
      video.pause(); video.src = c.url;
      video.load();
      video.addEventListener('loadedmetadata', () => { if (c === selectedClip()) { video.currentTime = c.start; updatePlayback(); } }, { once: true });
    }
    if (changing && c.type !== 'image' && video.readyState >= 1) video.currentTime = c.start;
    $('selectedHint').textContent = `${c.name} • ${c.width} × ${c.height}`;
    $('trimStart').disabled = $('trimEnd').disabled = $('speed').disabled = false;
    $('trimStart').value = Number(c.start.toFixed(2));
    $('trimEnd').value = Number(c.end.toFixed(2));
    $('trimEnd').max = c.duration;
    $('trimStart').max = c.duration;
    $('speed').disabled = c.type === 'image';
    video.playbackRate = c.speed;
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
  const view = $('timeline'); const scroll = view.scrollLeft; view.replaceChildren();
  $('totalDuration').textContent = `${totalDuration().toFixed(2)}s total`;
  if (!state.clips.length) { const div = document.createElement('div'); div.className = 'timeline-empty'; div.textContent = 'Drop videos or images here, or use Import media'; view.append(div); return; }
  let before = 0;
  state.clips.forEach((c, i) => {
    const item = document.createElement('div'); item.tabIndex = 0; item.setAttribute('role', 'button');
    item.className = `timeline-clip ${i === state.selected ? 'active' : ''}`;
    item.style.width = `${Math.max(2, duration(c) * pixelsPerSecond)}px`; item.draggable = true;
    item.title = `${c.name}: ${before.toFixed(2)}s – ${(before + duration(c)).toFixed(2)}s. Drag to reorder; drag edges to trim.`;
    const strip = document.createElement('div'); strip.className = 'thumbnail-strip';
    for (const src of c.thumbnails || []) { const img = document.createElement('img'); img.src = src; img.alt = ''; img.draggable = false; strip.append(img); }
    const name = document.createElement('strong'); name.textContent = `${before.toFixed(1)}s · ${c.name}`;
    const meta = document.createElement('span'); meta.textContent = `${duration(c).toFixed(2)}s · ${c.speed}×`;
    item.append(strip, name, meta);
    for (const edge of ['start', 'end']) {
      const handle = document.createElement('div'); handle.className = `trim-handle ${edge}`; handle.title = `Trim ${edge}`;
      handle.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation(); setSelection(i); checkpoint();
        const original = { ...state.clips[i] }; const origin = e.clientX;
        const move = ev => {
          state.clips[i] = Timeline.trim(original, edge, original[edge] + (ev.clientX - origin) / pixelsPerSecond * original.speed);
          const edited = state.clips[i]; $('timeline').children[i].style.width = `${Math.max(2, duration(edited) * pixelsPerSecond)}px`;
          $('trimStart').value = edited.start.toFixed(2); $('trimEnd').value = edited.end.toFixed(2);
        };
        const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); seekLocal(0); setSelection(i); };
        document.addEventListener('pointermove', move); document.addEventListener('pointerup', up, { once: true });
      });
      item.append(handle);
    }
    const head = document.createElement('div'); head.className = 'clip-playhead'; item.append(head);
    item.addEventListener('click', e => { if (e.target.closest('.trim-handle')) return; const fraction = Math.max(0, Math.min(1, (e.clientX - item.getBoundingClientRect().left) / item.clientWidth)); setSelection(i); seekLocal(fraction * duration(c)); });
    item.addEventListener('keydown', e => { if (e.key === 'Enter') setSelection(i); });
    item.addEventListener('dragstart', e => { dragIndex = i; e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move'; });
    item.addEventListener('dragend', () => { dragIndex = null; });
    item.addEventListener('dragover', e => { e.preventDefault(); });
    item.addEventListener('drop', e => { if (dragIndex === null) return; e.preventDefault(); e.stopPropagation(); const from = dragIndex; dragIndex = null; if (from !== i) { checkpoint(); state.clips = Timeline.reorder(state.clips, from, i); state.selected = -1; setSelection(i); } });
    view.append(item); before += duration(c);
  });
  view.scrollLeft = scroll;
}
function moveClip(index, amount) {
  const next = index + amount;
  if (next < 0 || next >= state.clips.length) return;
  checkpoint();
  const selectedObject = selectedClip();
  [state.clips[index], state.clips[next]] = [state.clips[next], state.clips[index]];
  setSelection(state.clips.findIndex(c => c === selectedObject));
  updateOverlay();
}
function removeClip(index) {
  checkpoint();
  const selectedObject = selectedClip();
  state.clips.splice(index, 1);
  const found = state.clips.findIndex(x => x === selectedObject);
  const target = found < 0 ? Math.min(index, state.clips.length - 1) : found;
  // Refresh media even when selection index remains the same but its clip changed.
  state.selected = -1;
  setSelection(target);
  updateOverlay();
}
function updatePlayback() {
  const c = selectedClip(); const t = c ? Math.max(0, localTime()) : 0;
  $('currentTime').textContent = `${t.toFixed(2)}s`;
  $('endTime').textContent = c ? `${duration(c).toFixed(2)}s` : '0.00s';
  $('seek').value = c ? String(Math.max(0, Math.min(100, t / duration(c) * 100))) : '0';
  $('playButton').textContent = (c?.type === 'image' ? !imagePlaying : video.paused) ? '▶' : 'Ⅱ';
  const head = document.querySelector('.timeline-clip.active .clip-playhead');
  if (head) head.style.left = `${Math.min(100, t / duration(c) * 100)}%`;
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
  $('imagePreview').style.objectFit = video.style.objectFit = state.mode === 'crop' ? 'cover' : 'contain';
}
async function importVideos() {
  try {
    const imported = await window.reeldesk.chooseVideos();
    if (!imported.length) return;
    checkpoint();
    const startingLength = state.clips.length;
    state.clips.push(...imported.map(c => ({ ...c, start: 0, end: c.duration, speed: 1 })));
    if (state.clips.length > 50) state.clips.length = 50;
    setSelection(startingLength < 50 ? startingLength : 0);
    setStatus(`${imported.length} clip(s) imported • Drag clips to reorder; drag edges to trim`);
  } catch (err) { setStatus(err.message, true); }
}
function editTrim(which, value) {
  const c = selectedClip(); if (!c) return;
  const parsed = Number(value); if (!Number.isFinite(parsed)) return;
  Object.assign(c, Timeline.trim(c, which, parsed));
  $('trimStart').value = Number(c.start.toFixed(2)); $('trimEnd').value = Number(c.end.toFixed(2));
  if (video.currentTime < c.start || video.currentTime > c.end) video.currentTime = c.start;
  seekLocal(Math.min(localTime(), duration(c)));
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
    checkpoint();
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
  try { const music = await window.reeldesk.chooseMusic(); if (music) { checkpoint(); state.music = music; syncControls(); setStatus('Music selected • It will play in the export'); } }
  catch (err) { setStatus(err.message, true); }
});
$('removeMusic').addEventListener('click', () => { checkpoint(); state.music = null; syncControls(); });
$('musicVolume').addEventListener('input', e => { state.musicVolume = Number(e.target.value) / 100; $('musicVolumeLabel').textContent = `${e.target.value}%`; });
$('playButton').addEventListener('click', async () => {
  const c = selectedClip(); if (!c) return;
  if (localTime() >= duration(c) - 0.01) seekLocal(0);
  if (c.type === 'image') { imagePlaying = !imagePlaying; }
  else if (video.paused) { try { await video.play(); } catch { setStatus('This codec cannot preview; export may still work', true); } }
  else video.pause();
  updatePlayback();
});
video.addEventListener('timeupdate', () => { const c = selectedClip(); if (c && c.type !== 'image' && video.currentTime >= c.end) { video.pause(); video.currentTime = c.end; } updatePlayback(); });
let lastFrame = performance.now();
function tick(now) { const elapsed = (now - lastFrame) / 1000; lastFrame = now; const c = selectedClip(); if (imagePlaying && c?.type === 'image') { imageTime = Math.min(duration(c), imageTime + elapsed); if (imageTime >= duration(c)) imagePlaying = false; updatePlayback(); } requestAnimationFrame(tick); }
requestAnimationFrame(tick);
video.addEventListener('pause', updatePlayback);
video.addEventListener('play', updatePlayback);
video.addEventListener('error', () => { if (selectedClip()) setStatus('Preview unavailable for this codec; try an MP4/H.264 clip', true); });
$('seek').addEventListener('input', e => {
  const c = selectedClip(); if (!c) return;
  seekLocal(Number(e.target.value) / 100 * duration(c));
  updatePlayback();
});
$('trimStart').addEventListener('change', e => editTrim('start', e.target.value));
$('trimEnd').addEventListener('change', e => editTrim('end', e.target.value));
$('speed').addEventListener('change', e => { const c = selectedClip(); if (!c) return; c.speed = Number(e.target.value); video.playbackRate = c.speed; renderTimeline(); renderClipList(); updateOverlay(); });
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

$('undo').addEventListener('click', () => restore('undo'));
$('redo').addEventListener('click', () => restore('redo'));
$('split').addEventListener('click', () => {
  try { const next = Timeline.split(state.clips, state.selected, localTime()); checkpoint(); state.clips = next; const target = state.selected + 1; state.selected = -1; setSelection(target); seekLocal(0); }
  catch (err) { setStatus(err.message, true); }
});
$('zoom').addEventListener('input', e => { pixelsPerSecond = Number(e.target.value); renderTimeline(); updatePlayback(); });
$('imageDuration').addEventListener('change', e => {
  const c = selectedClip(); if (c?.type !== 'image') return;
  const value = Number(e.target.value); if (!Number.isFinite(value) || value < 0.05 || value > 3600) { e.target.value = duration(c); return; }
  c.start = 0; c.end = value; seekLocal(0); setSelection(state.selected);
});
// Capture state before form controls mutate it. Timeline and project operations checkpoint explicitly.
const editableControls = new Set(['trimStart','trimEnd','speed','ratio','mode','resolution','titleText','titleStart','titleEnd','titleColor','titlePosition','musicVolume','imageDuration']);
document.addEventListener('input', e => { if (editableControls.has(e.target.id)) checkpoint(); }, true);
document.addEventListener('change', e => { if (editableControls.has(e.target.id) && e.target.tagName === 'SELECT') checkpoint(); }, true);
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)) { e.preventDefault(); restore(e.shiftKey ? 'redo' : 'undo'); }
});
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', async e => {
  e.preventDefault(); if (!e.dataTransfer.files.length) return;
  try { const files = await window.reeldesk.dropMedia(Array.from(e.dataTransfer.files)); if (!files.length) return; checkpoint(); const start = state.clips.length; state.clips.push(...files.slice(0, 50 - start).map(c => ({ ...c, start: 0, end: c.duration, speed: 1 }))); setSelection(Math.min(start, 49)); }
  catch (err) { setStatus(err.message, true); }
});
updateHistory();
