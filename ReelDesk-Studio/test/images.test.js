'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { normalizeProject, runExport, probeFile, findBinary } = require('../src/exporter');
const { importMedia, cleanup } = require('../src/media');
const { split, reorder } = require('../src/timeline');
const available = spawnSync(findBinary('ffmpeg'), ['-version']).status === 0;
const exec = args => { const p = spawnSync(findBinary('ffmpeg'), ['-v','error','-y', ...args], { encoding: 'utf8' }); assert.equal(p.status, 0, p.stderr); return p; };
test('imports JPG/PNG/WebP, caches thumbnails, renders reordered split mixed media with exact timing', { skip: !available, timeout: 120000 }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'reeldesk-images-'));
  try {
    for (const ext of ['jpg','png','webp']) {
      const file = path.join(temp, `red.${ext}`);
      if (ext === 'webp') fs.writeFileSync(file, Buffer.from('UklGRmIAAABXRUJQVlA4IFYAAABQBQCdASp4AFAAPm02mUmkIyKhIMgAgA2JaQB2APwAAAxvdTfRtQ5xlAPdTfRtQ5xk/0AA/vCbQ//+QXLC65Gv//yA/5Af8gP/498W46CVoAgAAAAAAA==', 'base64'));
      else exec(['-f','lavfi','-i','color=red:s=120x80','-frames:v','1',file]);
      const image = await importMedia(file); assert.equal(image.type, 'image'); assert.equal(image.width, 120);
      assert.equal(image.thumbnails.length, 1); assert.equal(await importMedia(file), image);
    }
    const videoPath = path.join(temp, 'blue.mp4');
    exec(['-f','lavfi','-i','color=blue:s=160x120:r=30:d=2','-f','lavfi','-i','sine=frequency=440:duration=2','-c:v','libx264','-c:a','aac','-shortest',videoPath]);
    const video = await importMedia(videoPath); assert.equal(video.thumbnails.length, 3);
    const image = await importMedia(path.join(temp, 'red.png'));
    const assets = new Map([['v', video], ['i', image]]);
    let clips = split([{ id:'v', start:0.2, end:1.8, speed:2 }], 0, 0.4);
    clips.push({ id:'i', start:0.2, end:1.2, speed:1 }); clips = reorder(clips, 2, 1);
    const project = normalizeProject({ clips, ratio:'1:1', resolution:720 }, assets);
    assert(Math.abs(project.duration - 1.8) < 1e-9);
    const out = path.join(temp, 'out.mp4'); await runExport(project, out).promise;
    const actual = await probeFile(out); assert(Math.abs(actual.duration - project.duration) < 0.08); assert(actual.hasAudio);
    for (const [t, expected] of [[0.2,'blue'],[0.8,'red'],[1.6,'blue']]) {
      const p = spawnSync(findBinary('ffmpeg'), ['-v','error','-ss',String(t),'-i',out,'-frames:v','1','-vf','scale=1:1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);
      assert.equal(p.status, 0); const [r,g,b] = p.stdout;
      assert(expected === 'red' ? r > b + 100 : b > r + 100, `Expected ${expected} at ${t}: ${[r,g,b]}`);
    }
    for (const invalid of [{ id:'i',start:0,end:1,speed:2 },{id:'v',start:2,end:2.01,speed:1},{id:'i',start:0,end:Infinity,speed:1}]) assert.throws(() => normalizeProject({clips:[invalid]},assets));
  } finally { cleanup(); fs.rmSync(temp, { recursive:true, force:true }); }
});
