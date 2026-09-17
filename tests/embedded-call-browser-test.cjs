'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const current = fs.readFileSync(path.join(root, 'public/embedded-call-view.js'), 'utf8');
const historical = (process.env.DIZY_CALL_COMPARE_REFS || '').split(',').filter(Boolean);

async function fixture(browser, source) {
  const page = await browser.newPage();
  await page.setContent('<main id="chat-main"><div id="chat-content"><div id="messages"></div></div><section class="voice-call-panel"><div class="call-video-grid"></div></section></main>');
  await page.evaluate(() => {
    // This guard is test instrumentation, not a production workaround. Break an
    // otherwise infinite microtask loop so CI reports the causal mutation records.
    const NativeObserver = window.MutationObserver;
    window.observerDiagnostic = {callbacks:0,guard:false,records:[]};
    window.MutationObserver = class extends NativeObserver {
      constructor(callback) {
        super((records, observer) => {
          const d=window.observerDiagnostic;
          d.callbacks++;
          if (d.records.length < 6) d.records.push(records.map(r=>({type:r.type,attribute:r.attributeName,target:r.target.className})));
          if (d.callbacks > 100) { d.guard=true; observer.disconnect(); return; }
          callback(records,observer);
        });
      }
    };
    // No real capture, devices, signaling server, or audio routing in this test.
    window.captureRequests=[];
    const track={addEventListener(){},stop(){},contentHint:''};
    const stream=new MediaStream();
    stream.getVideoTracks=()=>[track];
    stream.getTracks=()=>[track];
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getDisplayMedia:async options=>{window.captureRequests.push(options);return stream;}}});
    window.makeTestRoom=()=>{
      const handlers=new Map();
      return {
        remoteParticipants:new Map(),
        localParticipant:{publishTrack:async track=>({track}),unpublishTrack:async()=>{}},
        on(event,fn){const list=handlers.get(event)||[];list.push(fn);handlers.set(event,list);},
        emit(event,...args){for(const fn of handlers.get(event)||[])fn(...args);},
      };
    };
    window.testSdk={Track:{Kind:{Video:'video'},Source:{ScreenShare:'screen_share'}},RoomEvent:{TrackSubscribed:'trackSubscribed',TrackUnsubscribed:'trackUnsubscribed',Disconnected:'disconnected'}};
    window.connectTestRoom=()=>{
      window.testRoom=window.makeTestRoom();
      window.dispatchEvent(new CustomEvent('dizychat:call-room',{detail:{room:window.testRoom,sdk:window.testSdk}}));
    };
  });
  await page.addScriptTag({content:source});
  return page;
}
async function mediaCase(browser, source, mode) {
  const page=await fixture(browser,source);
  try {
    return await page.evaluate(async mode=>{
      // Equivalent DOM boundary to chat.js TrackSubscribed before its room bridge.
      if(mode!=='audio') {
        const tile=document.createElement('div');
        tile.className='call-video-tile'+(mode==='screen'?' dizy-screen-share-tile':'');
        document.querySelector('.call-video-grid').append(tile);
      }
      // A task boundary proves the observer queue settles without timer starvation.
      await new Promise(resolve=>setTimeout(resolve,0));
      const beforeBridge={...window.observerDiagnostic};
      window.connectTestRoom();
      await new Promise(resolve=>setTimeout(resolve,0));
      return {mode,beforeBridge,afterBridge:{...window.observerDiagnostic},presentation:document.querySelector('.dizy-call-stage').dataset.presentation,captures:window.captureRequests.length};
    },mode);
  } finally {await page.close();}
}
(async()=>{
  const browser=await chromium.launch({headless:true});
  try {
    for (const ref of historical) {
      const source=execFileSync('git',['show',`${ref}:public/embedded-call-view.js`],{cwd:root,encoding:'utf8'});
      for(const mode of ['audio','camera','screen']) {
        const result=await mediaCase(browser,source,mode);
        console.log(JSON.stringify({ref,...result}));
        assert.equal(result.beforeBridge.guard,mode!=='audio',`${ref} ${mode}: historical observer characterization`);
        assert.equal(result.captures,0);
      }
    }
    for(const mode of ['audio','camera','screen']) {
      const result=await mediaCase(browser,current,mode);
      console.log(JSON.stringify({ref:'current',...result}));
      assert.equal(result.afterBridge.guard,false,`${mode}: observer loop starves the join continuation`);
      assert.ok(result.afterBridge.callbacks<10);
      assert.equal(result.presentation,{audio:'audio',camera:'camera-grid',screen:'screen-share'}[mode]);
      assert.equal(result.captures,0);
    }
    const page=await fixture(browser,current);
    try {
      await page.evaluate(()=>window.connectTestRoom());
      await page.getByRole('button',{name:'Share Screen',exact:true}).click();
      await page.getByRole('button',{name:'Stop Screen',exact:true}).waitFor();
      assert.equal(await page.locator('.dizy-call-stage').getAttribute('data-presentation'),'screen-share');
      await page.getByRole('button',{name:'Stop Screen',exact:true}).click();
      assert.equal(await page.locator('.dizy-call-stage').getAttribute('data-presentation'),'audio');
      await page.evaluate(()=>window.testRoom.emit('disconnected'));
      assert.equal(await page.getByRole('button',{name:'Share Screen',exact:true}).isEnabled(),false);
      await page.evaluate(()=>window.connectTestRoom());
      assert.equal(await page.getByRole('button',{name:'Share Screen',exact:true}).isEnabled(),true);
      const result=await page.evaluate(()=>({guard:window.observerDiagnostic.guard,captures:window.captureRequests}));
      assert.equal(result.guard,false);
      assert.equal(result.captures.length,1);
      assert.equal(result.captures[0].audio,false);
      console.log('PASS: connected bridge -> Share Screen -> Stop Screen -> disconnect -> rejoin; video-only capture');
    } finally {await page.close();}
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
