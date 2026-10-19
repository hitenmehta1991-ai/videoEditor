'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); } catch { /* Optional UI runner. */ }
test('timeline UI: import, split, reorder, trim, image duration, undo/redo and export payload', { skip: !chromium, timeout: 60000 }, async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || chromium.executablePath() });
  try {
    const page = await browser.newPage({ viewport: { width:1460, height:920 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      const thumb = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="red"/></svg>');
      const image = id => ({ id, name:id+'.png', type:'image', url:thumb, thumbnails:[thumb], duration:5, width:160, height:90 });
      window.reeldesk = { chooseVideos:async () => [image('first'),image('second')], chooseMusic:async () => ({id:'voice',name:'voice.wav',duration:2}), previewSequence:async () => 'file:///tmp/reeldesk-ui-preview.mp4',
        saveProject:async p => { window.savedProject=p; return 'saved'; }, openProject:async () => null,
        exportVideo:async p => { window.exportPayload=p; return { cancelled:true }; }, onExportProgress:()=>{}, cancelExport:()=>{}, revealExport:()=>{} };
    });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../src/index.html')).href);
    await page.locator('#importButton').click(); await page.locator('.timeline-clip').nth(1).waitFor();
    assert.equal(await page.locator('.thumbnail-strip img').count(), 2);
    await page.locator('#seek').fill('40'); await page.locator('#seek').dispatchEvent('input');
    await page.locator('#split').click(); assert.equal(await page.locator('.timeline-clip').count(), 3);
    await page.locator('#undo').click(); assert.equal(await page.locator('.timeline-clip').count(), 2);
    await page.locator('#redo').click(); assert.equal(await page.locator('.timeline-clip').count(), 3);
    await page.locator('.timeline-clip').nth(2).dragTo(page.locator('.timeline-clip').nth(0));
    await page.locator('#saveProject').click();
    assert.equal((await page.evaluate(() => window.savedProject)).clips[0].id, 'second');
    await page.locator('#imageDuration').fill('7'); await page.locator('#imageDuration').press('Tab');
    await page.locator('#saveProject').click(); assert.equal((await page.evaluate(() => window.savedProject)).clips[0].end, 7);
    const handle = page.locator('.timeline-clip').first().locator('.trim-handle.end'); const box = await handle.boundingBox();
    await page.mouse.move(box.x+3,box.y+20); await page.mouse.down(); await page.mouse.move(box.x-37,box.y+20); await page.mouse.up();
    await page.locator('#exportButton').click();
    const output = await page.evaluate(() => window.exportPayload); assert.equal(output.clips[0].end, 6); assert.equal(output.clips.length, 3);
    await page.locator('#undo').click(); await page.locator('#exportButton').click(); assert.equal((await page.evaluate(() => window.exportPayload)).clips[0].end, 7);
    await page.locator('#transitionType').selectOption('fade');
    await page.locator('#transitionDuration').fill('0.5'); await page.locator('#transitionDuration').press('Tab');
    assert.match(await page.locator('#totalDuration').textContent(), /11.50s/);
    await page.locator('#addAudioTrack').click();
    const track = page.locator('.audio-track'); await track.locator('[data-field="start"]').fill('1'); await track.locator('[data-field="start"]').press('Tab');
    await track.locator('[data-field="fadeIn"]').fill('0.2'); await track.locator('[data-field="fadeIn"]').press('Tab');
    await track.locator('[data-field="loop"]').check();
    await page.locator('#exportButton').click();
    const edited = await page.evaluate(() => window.exportPayload);
    assert.equal(edited.clips[0].transition.type, 'fade'); assert.equal(edited.audioTracks[0].start,1); assert.equal(edited.audioTracks[0].fadeIn,0.2); assert.equal(edited.audioTracks[0].loop,true);
    await page.locator('#previewSequence').click(); await page.locator('#backToClip').waitFor(); assert.equal(await page.locator('#sequencePreview').isVisible(),true);
    await page.locator('#backToClip').click(); assert.equal(await page.locator('#sequencePreview').isVisible(),false);
    await track.getByRole('button', {name:'Remove'}).click(); assert.equal(await page.locator('.audio-track').count(),0);
    await page.locator('#undo').click(); assert.equal(await page.locator('.audio-track').count(),1);
    assert.deepEqual(errors, []);
    if (process.env.UI_SCREENSHOT) await page.screenshot({ path:process.env.UI_SCREENSHOT });
  } finally { await browser.close(); }
});
