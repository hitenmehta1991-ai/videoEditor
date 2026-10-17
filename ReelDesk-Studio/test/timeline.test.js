'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { duration, split, trim, reorder, History } = require('../src/timeline');
const clip = { id: 'source', start: 2, end: 8, duration: 10, speed: 2, type: 'video' };
test('split preserves source ranges and speed-adjusted duration', () => {
  const result = split([clip], 0, 1);
  assert.equal(result[0].end, 4); assert.equal(result[1].start, 4);
  assert.equal(result[0].id, result[1].id);
  assert.equal(result.reduce((sum, c) => sum + duration(c), 0), duration(clip));
  assert.equal(clip.end, 8);
  for (const t of [0, 3, -1, NaN]) assert.throws(() => split([clip], 0, t));
  assert.throws(() => split(Array(50).fill(clip), 0, 1));
});
test('trim bounds source media and supports image extension', () => {
  assert.equal(trim(clip, 'start', -10).start, 0);
  assert.equal(trim(clip, 'end', 200).end, 10);
  assert(Math.abs(trim(clip, 'start', 200).start - 7.95) < 1e-9);
  assert.equal(trim({ ...clip, type: 'image' }, 'end', 20).end, 20);
  assert.throws(() => trim(clip, 'end', Infinity));
});
test('reorder distinguishes split instances of the same source', () => {
  const clips = split([clip], 0, 1); const next = reorder(clips, 0, 1);
  assert.equal(next[0], clips[1]); assert.equal(clips[0].start, 2);
  assert.throws(() => reorder(clips, -1, 1));
});
test('undo/redo restores edits, bounds memory, and clears redo after new edit', () => {
  const h = new History(2); let state = { clips: [clip] };
  h.push(state); state = { clips: split(state.clips, 0, 1) };
  const undo = h.undo(state); assert.deepEqual(undo.clips, [clip]);
  const redo = h.redo(undo); assert.deepEqual(redo, state);
  h.undo(redo); h.push(undo); assert.equal(h.redo(undo), null);
  h.push(undo); assert.equal(h.past.length, 1);
  h.push({ clips: [] }); h.push({ clips: [clip], selected: 0 }); assert.equal(h.past.length, 2);
});
