'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
let electron;
if (process.env.ELECTRON_PATH) { ({ _electron:electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); }
test('Electron sandbox bridge imports and saves image clips', { skip:!electron, timeout:60000 }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'reeldesk-electron-'));
  let app;
  try {
    const file = path.join(temp,'image.png'); const save = path.join(temp,'test.reeldesk.json');
    const gen = spawnSync(require('../src/exporter').findBinary('ffmpeg'),['-v','error','-f','lavfi','-i','color=green:s=160x120','-frames:v','1',file]); assert.equal(gen.status,0);
    app = await electron.launch({ executablePath:process.env.ELECTRON_PATH,args:[path.resolve(__dirname,'..')],env:{...process.env,ELECTRON_RUN_AS_NODE:''} });
    await app.evaluate(({dialog}, paths) => {
      dialog.showOpenDialog = async () => ({filePaths:[paths.file]});
      dialog.showSaveDialog = async () => ({filePath:paths.save});
    },{file,save});
    const page = await app.firstWindow(); const errors = []; page.on('pageerror',e=>errors.push(e.message));
    await page.locator('#importButton').click(); await page.locator('.timeline-clip').waitFor();
    assert.equal(await page.locator('.thumbnail-strip img').count(),1);
    await page.locator('#saveProject').click(); await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('project saved'));
    const project = JSON.parse(fs.readFileSync(save)); assert.equal(project.clips[0].type,'image'); assert.equal(project.clips[0].end,5);
    assert.deepEqual(errors,[]);
  } finally { if(app) await app.close(); fs.rmSync(temp,{recursive:true,force:true}); }
});
