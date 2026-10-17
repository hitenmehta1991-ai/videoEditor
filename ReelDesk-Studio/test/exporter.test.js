'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { dimensions, normalizeProject, makeArgs, runExport, findBinary, probeFile } = require('../src/exporter');

test('correct social media dimensions', () => {
  assert.deepEqual(dimensions('9:16', 1080), { width: 1080, height: 1920 });
  assert.deepEqual(dimensions('16:9', 1080), { width: 1920, height: 1080 });
  assert.deepEqual(dimensions('1:1', 720), { width: 720, height: 720 });
  assert.throws(() => dimensions('3:7', 1080));
});

test('rejects invalid edits and unpicked paths', () => {
  assert.throws(() => normalizeProject({ clips: [{ id: 'fake', start: 0, end: 5, speed: 1 }] }, new Map()), /available/);
  assert.throws(() => normalizeProject({ clips: [] }, new Map()));
});

const hasFfmpeg = spawnSync(findBinary('ffmpeg'), ['-version']).status === 0 && spawnSync(findBinary('ffprobe'), ['-version']).status === 0;

test('exports assembled clips with music and a timed title', { skip: !hasFfmpeg, timeout: 120000 }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'reeldesk-test-'));
  try {
    const one = path.join(temp, 'one.mp4');
    const two = path.join(temp, 'two.mp4');
    const music = path.join(temp, 'music.wav');
    const output = path.join(temp, 'test-output.mp4');
    const execute = args => { const result = spawnSync(findBinary('ffmpeg'), args, { encoding: 'utf8', timeout: 20000 });
      if (result.status !== 0) throw Error(result.stderr.slice(-1300)); };
    execute(['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30:duration=1.5',
      '-f', 'lavfi', '-i', 'sine=frequency=500:sample_rate=48000:duration=1.5',
      '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', '-shortest', one]);
    execute(['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:size=240x320:rate=30:duration=1',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', two]);
    execute(['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=1', music]);
    const p1 = await probeFile(one), p2 = await probeFile(two);
    assert.equal(p1.hasAudio, true); assert.equal(p2.hasAudio, false);
    const map = new Map([
      ['one', { type: 'video', name: 'one.mp4', path: one, ...p1 }],
      ['two', { type: 'video', name: 'two.mp4', path: two, ...p2 }],
      ['music', { type: 'music', name: 'music.wav', path: music }]
    ]);
    const project = normalizeProject({ clips: [
      { id: 'one', start: 0.2, end: 1.2, speed: 1.25 },
      { id: 'two', start: 0, end: 1, speed: 1 }
    ], musicId: 'music', musicVolume: 0.15, ratio: '9:16', resolution: 720, mode: 'crop',
    title: 'Day 01', titleStart: 0, titleEnd: 1, titlePosition: 'bottom' }, map);
    assert.equal(project.width, 720);
    const args = makeArgs(project, output, path.join(temp, 'title.txt'));
    assert(args.includes('-filter_complex'));
    const exportJob = runExport(project, output);
    await exportJob.promise;
    const actual = await probeFile(output);
    assert.equal(actual.width, 720); assert.equal(actual.height, 1280);
    assert(actual.hasAudio); assert(actual.duration > 1.5);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
