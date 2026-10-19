/* Shared non-destructive timeline math; source times remain in media seconds. */
(function (root) {
  'use strict';
  const MIN = 0.05;
  const TRANSITIONS = Object.freeze({ none: 'Cut', fade: 'Crossfade', dissolve: 'Dissolve', slideleft: 'Slide left', slideright: 'Slide right', wipeleft: 'Wipe', zoomin: 'Zoom', fadeblack: 'Fade through black', fadewhite: 'Flash' });
  function layout(clips) {
    let cursor = 0;
    return clips.map((clip, i) => {
      const length = duration(clip); const type = clip.transition?.type || 'none';
      const requested = Number(clip.transition?.duration ?? 0.5);
      if (!Object.hasOwn(TRANSITIONS, type) || !Number.isFinite(requested) || requested < 0 || requested > 5) throw Error('Invalid transition');
      // Half-clip bounds prevent overlapping three clips. Round overlaps down to output frames.
      const overlap = i === clips.length - 1 || type === 'none' ? 0 : Math.floor(Math.min(requested, length / 2, duration(clips[i + 1]) / 2) * 30 + 1e-8) / 30;
      const entry = { start: cursor, end: cursor + length, duration: length, overlap, type: overlap ? type : 'none' };
      cursor += length - overlap; return entry;
    });
  }
  function total(clips) { const entries = layout(clips); return entries.length ? entries[entries.length - 1].end : 0; }

  const duration = c => (c.end - c.start) / c.speed;
  function split(clips, index, offset) {
    const c = clips[index];
    if (!c || clips.length >= 50 || !Number.isFinite(offset)) throw Error('Cannot split this clip');
    const cut = c.start + offset * c.speed;
    if (cut - c.start < MIN || c.end - cut < MIN) throw Error('Split must leave at least 0.05 source seconds on each side');
    return [...clips.slice(0, index), { ...c, end: cut, transition: { type: 'none', duration: 0.5 }, fadeOut: 0 }, { ...c, start: cut, fadeIn: 0 }, ...clips.slice(index + 1)];
  }
  function trim(c, edge, value) {
    if (!Number.isFinite(value) || !['start', 'end'].includes(edge)) throw Error('Invalid trim');
    const limit = c.type === 'image' ? 3600 : c.duration;
    return { ...c, [edge]: edge === 'start' ? Math.max(0, Math.min(c.end - MIN, value)) : Math.max(c.start + MIN, Math.min(limit, value)) };
  }
  function reorder(clips, from, to) {
    if (![from, to].every(n => Number.isInteger(n) && n >= 0 && n < clips.length)) throw Error('Invalid clip position');
    const result = [...clips]; const [clip] = result.splice(from, 1); result.splice(to, 0, clip); return result;
  }
  class History {
    constructor(limit = 100) { this.past = []; this.future = []; this.limit = limit; }
    push(snapshot) { const value = JSON.stringify(snapshot); if (this.past[this.past.length - 1] !== value) this.past.push(value); if (this.past.length > this.limit) this.past.shift(); this.future = []; }
    undo(current) { if (!this.past.length) return null; this.future.push(JSON.stringify(current)); return JSON.parse(this.past.pop()); }
    redo(current) { if (!this.future.length) return null; this.past.push(JSON.stringify(current)); return JSON.parse(this.future.pop()); }
    clear() { this.past = []; this.future = []; }
  }
  const api = { MIN, TRANSITIONS, layout, total, duration, split, trim, reorder, History };
  if (typeof module !== 'undefined') module.exports = api; else root.Timeline = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
