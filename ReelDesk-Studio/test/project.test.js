'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
test('IPC saves split instances and images, reopens v1/v2 projects, and rejects untrusted calls', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'reeldesk-project-'));
  try {
    const handlers = new Map(); const sender = { setWindowOpenHandler(){}, on(){} };
    class Window { constructor(){this.webContents=sender;} loadFile(){} }
    const mediaPath = path.join(temp,'photo.png'); fs.writeFileSync(mediaPath,'fixture');
    const savePath = path.join(temp,'project.json');
    let openPath = mediaPath;
    const electron = { BrowserWindow:Window, app:{whenReady:()=>Promise.resolve(),on(){}},
      ipcMain:{handle:(name,fn)=>handlers.set(name,fn)}, shell:{},
      dialog:{showOpenDialog:async()=>({filePaths:[openPath]}),showSaveDialog:async()=>({filePath:savePath})} };
    const media = { importMedia:async file=>({type:'image',path:file,originalPath:file,previewPath:file,duration:5,width:120,height:80,thumbnails:[]}),cleanup(){} };
    const filename = path.resolve(__dirname,'../src/main.js');
    vm.runInNewContext(fs.readFileSync(filename,'utf8'), {require:name=>name==='electron'?electron:name==='./media'?media:name==='./exporter'?{...require('../src/exporter'),capture:async()=>JSON.stringify({format:{duration:2},streams:[{codec_type:'audio'}]})}:require(name),__dirname:path.dirname(filename),console});
    await Promise.resolve();
    await assert.rejects(handlers.get('choose-videos')({sender:{}}), /Untrusted/);
    const [image] = await handlers.get('choose-videos')({sender});
    const clips = [{id:image.id,start:0,end:1,speed:1},{id:image.id,start:1,end:4,speed:1}];
    clips[0].transition = {type:'fade',duration:0.5}; clips[0].volume = 0.4; clips[0].fadeIn = 0.1;
    const audioPath = path.join(temp,'voice.wav'); fs.writeFileSync(audioPath,'mock audio'); openPath = audioPath;
    const audio = await handlers.get('choose-music')({sender});
    await handlers.get('save-project')({sender},{clips,ratio:'1:1',musicId:audio.id,musicFadeIn:0.2,musicFadeOut:0.3,audioTracks:[{id:audio.id,start:0.5,trimStart:0.2,trimEnd:1.2,volume:0.5,fadeIn:0.1,fadeOut:0.2,loop:true}]});
    const saved = JSON.parse(fs.readFileSync(savePath)); assert.equal(saved.version,3); assert.equal(saved.clips[0].path,mediaPath); assert.equal(saved.clips[1].start,1);
    openPath = savePath;
    let opened = await handlers.get('open-project')({sender}); assert.equal(opened.clips.length,2); assert.equal(opened.clips[1].end,4); assert.equal(opened.clips[0].type,'image');
    assert.equal(opened.clips[0].transition.type,'fade'); assert.equal(opened.clips[0].volume,0.4); assert.equal(opened.musicFadeOut,0.3); assert.equal(opened.audioTracks[0].trimStart,0.2); assert.equal(opened.audioTracks[0].loop,true);
    assert.equal(opened.audioTracks[0].duration,2);
    saved.version = 1; delete saved.audioTracks; delete saved.clips[0].type; fs.writeFileSync(savePath,JSON.stringify(saved));
    opened = await handlers.get('open-project')({sender}); assert.equal(opened.clips.length,2);
    saved.clips[0].path += '-missing'; fs.writeFileSync(savePath,JSON.stringify(saved));
    await assert.rejects(handlers.get('open-project')({sender}), /Missing/);
  } finally {fs.rmSync(temp,{recursive:true,force:true});}
});
