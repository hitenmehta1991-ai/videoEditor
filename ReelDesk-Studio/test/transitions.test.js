'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { normalizeProject, runExport, probeFile, findBinary } = require('../src/exporter');
const Timeline = require('../src/timeline');
const ffmpeg = findBinary('ffmpeg');
const available = spawnSync(ffmpeg,['-version']).status === 0;
function execute(args) { const r = spawnSync(ffmpeg,['-v','error','-y',...args],{timeout:20000,maxBuffer:32*1024*1024}); assert.equal(r.status,0,r.stderr?.toString()); return r.stdout; }
function fixture(temp) {
  const red = path.join(temp,'red.png'), blue = path.join(temp,'blue.png'), sound = path.join(temp,'sound.wav');
  execute(['-f','lavfi','-i','color=red:s=160x120','-frames:v','1',red]);
  execute(['-f','lavfi','-i','color=blue:s=160x120','-frames:v','1',blue]);
  execute(['-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=2',sound]);
  return new Map([['r',{type:'image',path:red,duration:5}],['b',{type:'image',path:blue,duration:5}],['s',{type:'music',path:sound,duration:2}]]);
}
const clip = id=>({id,start:0,end:2,speed:1});
test('transition layout clamps adjacent overlaps, updates title offsets and preserves split outgoing transition', () => {
  const clips = [{...clip('r'),transition:{type:'fade',duration:5}},{...clip('b'),end:0.4,transition:{type:'slideleft',duration:5}},clip('r')];
  const entries = Timeline.layout(clips); assert.equal(entries[0].overlap,0.2); assert.equal(entries[1].start,1.8); assert.equal(entries[1].overlap,0.2); assert.equal(Timeline.total(clips),4);
  const split = Timeline.split([{...clip('r'),transition:{type:'fade',duration:0.5},fadeIn:0.2,fadeOut:0.3}],0,1);
  assert.equal(split[0].transition.type,'none'); assert.equal(split[1].transition.type,'fade'); assert.equal(split[0].fadeOut,0); assert.equal(split[1].fadeIn,0);
});
test('renders every transition with aligned video/audio duration; crossfade blends frames', {skip:!available,timeout:120000}, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'reeldesk-transition-'));
  try {
    const assets = fixture(temp);
    for (const type of Object.keys(Timeline.TRANSITIONS).filter(t=>t!=='none')) {
      const project = normalizeProject({clips:[{...clip('r'),transition:{type,duration:0.5}},clip('b')],resolution:720,ratio:'1:1'},assets);
      assert.equal(project.duration,3.5);
      const out = path.join(temp,`${type}.mp4`); await runExport(project,out).promise;
      const probe = await probeFile(out); assert(Math.abs(probe.duration-3.5)<0.08,`${type}: ${probe.duration}`); assert(probe.hasAudio);
      if(type==='fade') {
        const pixels = execute(['-ss','1.75','-i',out,'-frames:v','1','-vf','scale=1:1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);
        assert(pixels[0]>60 && pixels[2]>60, `Crossfade should blend red and blue: ${[...pixels]}`);
      }
    }
    const hybrid = normalizeProject({clips:[{...clip('r'),transition:{type:'fade',duration:0.5}},clip('b'),{...clip('r'),transition:{type:'slideleft',duration:0.5}},clip('b')],resolution:720,ratio:'1:1'},assets);
    const out = path.join(temp,'mixed.mp4'); await runExport(hybrid,out).promise; assert(Math.abs((await probeFile(out)).duration-7)<0.08);
    for(const bad of [{clips:[{...clip('r'),transition:{type:'inject',duration:1}}]}, {clips:[clip('r')],audioTracks:[{id:'s',trimStart:2,trimEnd:1}]}, {clips:[{...clip('r'),volume:NaN}]}, {clips:[clip('r')],audioTracks:[{id:'s',start:-1}]}]) assert.throws(()=>normalizeProject(bad,assets));
  } finally {fs.rmSync(temp,{recursive:true,force:true});}
});
function rms(samples, start, end) { let sum=0,n=0; for(let i=Math.floor(start*48000);i<Math.floor(end*48000);i++){const v=samples.readFloatLE(i*4);sum+=v*v;n++;} return Math.sqrt(sum/n); }
test('mixes delayed trimmed looping tracks, volume and fades without shifting audio timing', {skip:!available,timeout:60000}, async () => {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'reeldesk-audio-'));
  try {
    const assets=fixture(temp);
    const project=normalizeProject({clips:[{...clip('r'),end:4}],audioTracks:[{id:'s',start:1,trimStart:0.5,trimEnd:1,volume:0.5,fadeIn:0.4,fadeOut:0.4,loop:true}],resolution:720,ratio:'1:1'},assets);
    const out=path.join(temp,'audio.mp4');await runExport(project,out).promise;
    const pcm=execute(['-i',out,'-vn','-ar','48000','-ac','1','-f','f32le','pipe:1']);
    const steady=rms(pcm,2,2.2); assert(steady>0.02); assert(rms(pcm,0.2,0.6)<0.001); assert(rms(pcm,1.02,1.1)<steady/2); assert(rms(pcm,3.9,3.98)<steady/2);
    const bed=normalizeProject({clips:[{...clip('r'),end:4}],musicId:'s',musicVolume:0.5,musicFadeIn:0.4,musicFadeOut:0.4,audioTracks:[{id:'s',start:1,trimStart:0,trimEnd:1,volume:0.25}],resolution:720,ratio:'1:1'},assets);
    const bedOut=path.join(temp,'bed.mp4');await runExport(bed,bedOut).promise;
    const bedPcm=execute(['-i',bedOut,'-vn','-ar','48000','-ac','1','-f','f32le','pipe:1']);
    const bedSteady=rms(bedPcm,2.5,2.7);assert(rms(bedPcm,0.02,0.08)<bedSteady/2);assert(rms(bedPcm,3.92,3.98)<bedSteady/2);assert(rms(bedPcm,1.3,1.5)>bedSteady*1.3);
    const finite=normalizeProject({clips:[{...clip('r'),end:4}],audioTracks:[{id:'s',start:1,trimStart:0.5,trimEnd:1,volume:0.5,loop:false},{id:'s',start:10,volume:1}],resolution:720,ratio:'1:1'},assets);
    const short=path.join(temp,'short.mp4');await runExport(finite,short).promise;
    const pcm2=execute(['-i',short,'-vn','-ar','48000','-ac','1','-f','f32le','pipe:1']);assert(rms(pcm2,1.1,1.3)>0.02);assert(rms(pcm2,1.8,2)<0.001);
  } finally {fs.rmSync(temp,{recursive:true,force:true});}
});
test('speed-adjusted video audio fades and mute survive transitions with stills and cuts', {skip:!available,timeout:60000}, async () => {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'reeldesk-video-fades-'));
  try {
    const assets=fixture(temp); const source=path.join(temp,'source.mp4');
    execute(['-f','lavfi','-i','color=blue:s=160x120:r=30:d=2.4','-f','lavfi','-i','sine=frequency=440:duration=2.4','-c:v','libx264','-c:a','aac','-shortest',source]);
    assets.set('v',{type:'video',path:source,...await probeFile(source)});
    const c={id:'v',start:0.2,end:2.2,speed:2,volume:0.5,fadeIn:0.2,fadeOut:0.2};
    const one=normalizeProject({clips:[c],resolution:720,ratio:'1:1'},assets); const oneOut=path.join(temp,'one.mp4'); await runExport(one,oneOut).promise;
    const pcm=execute(['-i',oneOut,'-vn','-ar','48000','-ac','1','-f','f32le','pipe:1']);
    const steady=rms(pcm,0.4,0.6); assert(steady>0.03 && steady<0.055); assert(rms(pcm,0.01,0.05)<steady/2); assert(rms(pcm,0.95,0.99)<steady/2);
    const clips=[{...c,transition:{type:'fade',duration:0.3}},{...clip('r'),end:1.4},{...c,speed:0.5,volume:0}];
    const project=normalizeProject({clips,resolution:720,ratio:'1:1'},assets); assert(Math.abs(project.duration-6.1)<1e-9);
    const out=path.join(temp,'mixed.mp4'); await runExport(project,out).promise;
    assert(Math.abs((await probeFile(out)).duration-6.1)<0.08);
    const mixed=execute(['-i',out,'-vn','-ar','48000','-ac','1','-f','f32le','pipe:1']); assert(rms(mixed,3,4)<0.001);
    const image=execute(['-ss','1.2','-i',out,'-frames:v','1','-vf','scale=1:1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']); assert(image[0]>image[2]+100);
  } finally {fs.rmSync(temp,{recursive:true,force:true});}
});
test('cancelled transition render removes partial output and preserves source media', {skip:!available,timeout:30000}, async () => {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'reeldesk-cancel-'));
  try {
    const assets=fixture(temp); const original=fs.readFileSync(assets.get('r').path);
    const project=normalizeProject({clips:[{...clip('r'),end:60,transition:{type:'fade',duration:1}},{...clip('b'),end:60}],resolution:720,ratio:'1:1'},assets);
    const out=path.join(temp,'cancelled.mp4'); const job=runExport(project,out);
    const timer=setTimeout(()=>job.cancel(),40);
    try {await assert.rejects(job.promise,/cancelled/);} finally {clearTimeout(timer);}
    assert.equal(fs.existsSync(out),false);assert.deepEqual(fs.readFileSync(assets.get('r').path),original);
  } finally {fs.rmSync(temp,{recursive:true,force:true});}
});
