'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const runtime = require('../public/embedded-call-view.js');
const { createHarness } = require('./helpers/embedded-call-dom.cjs');
const { EventEmitter } = require('node:events');
const LK = { Track: {Kind:{Video:'video'},Source:{ScreenShare:'screen_share',ScreenShareAudio:'screen_share_audio'}}, RoomEvent: {TrackSubscribed:'trackSubscribed',TrackUnsubscribed:'trackUnsubscribed',Disconnected:'disconnected'} };
function connect(h) {
  const room = new EventEmitter();
  room.remoteParticipants = new Map();
  room.localParticipant = {publishTrack:async track=>({track}),unpublishTrack:async()=>{}};
  h.listeners.get('dizychat:call-room')({detail:{room,sdk:LK}});
  h.flush();
  return room;
}
test('audio-only bootstrap settles and waits for the connected room bridge', () => {
  const h=createHarness(runtime);
  h.flush();
  assert.equal(h.api.state.stage.dataset.presentation,'audio');
  assert.equal(h.api.state.screenButton.disabled,true);
  connect(h);
  assert.equal(h.api.state.screenButton.disabled,false);
});
for (const source of ['camera','screen_share']) {
  test(`remote ${source} arriving before the connected-room bridge settles without starving join`, () => {
    const h=createHarness(runtime); h.flush();
    const tile=new h.Element(); tile.className='call-video-tile';
    if (source==='screen_share') tile.classList.add('dizy-screen-share-tile');
    h.grid.append(tile);
    assert.doesNotThrow(()=>h.flush(), 'incoming media must not perpetually reschedule the grid observer');
    assert.equal(h.api.state.room,null);
    const room=connect(h);
    assert.equal(h.api.state.room,room);
    assert.equal(h.api.state.stage.dataset.presentation,source==='camera'?'camera-grid':'screen-share');
    assert.equal(tile.classList.contains('dizy-primary-media'),source==='screen_share');
    h.listeners.get('dizychat:call-room')({detail:{room,sdk:LK}});
    assert.equal(room.listenerCount('disconnected'),1);
    h.flush();
    tile.remove(); h.flush();
    assert.equal(h.api.state.stage.dataset.presentation,'audio');
  });
}
test('changing an existing tile between camera and screen share settles and updates priority',()=>{
  const h=createHarness(runtime); h.flush(); connect(h);
  const tile=new h.Element();tile.className='call-video-tile';h.grid.append(tile);h.flush();
  tile.classList.add('dizy-screen-share-tile');h.flush();
  assert.equal(tile.classList.contains('dizy-primary-media'),true);
  assert.equal(h.api.state.stage.dataset.presentation,'screen-share');
  tile.classList.remove('dizy-screen-share-tile');h.flush();
  assert.equal(tile.classList.contains('dizy-primary-media'),false);
  assert.equal(h.api.state.stage.dataset.presentation,'camera-grid');
});
test('join first, share video plus application audio, stop, disconnect, and rejoin all settle', async()=>{
  const h=createHarness(runtime);h.flush();
  let captures=0,stops=0;
  const published=[];
  const videoTrack={addEventListener(){},stop(){stops++;},contentHint:'',getSettings(){return {displaySurface:'window'};}};
  const audioTrack={stop(){stops++;}};
  const stream={getVideoTracks:()=>[videoTrack],getAudioTracks:()=>[audioTrack],getTracks:()=>[videoTrack,audioTrack]};
  h.host.navigator.mediaDevices.getDisplayMedia=async options=>{
    captures++;
    assert.equal(options.audio.suppressLocalAudioPlayback,false);
    assert.equal(options.audio.restrictOwnAudio,true);
    assert.equal(options.systemAudio,'include');
    assert.equal(options.windowAudio,'window');
    return stream;
  };
  await h.api.startScreenShare();assert.equal(captures,0);
  const room=connect(h);
  room.localParticipant.publishTrack=async (track,options)=>{published.push({track,options});return {track};};
  await h.api.startScreenShare();
  await new Promise((resolve) => setImmediate(resolve));
  h.flush();
  assert.equal(captures,1);
  assert.ok(published.some(({track,options})=>track===videoTrack&&options.source==='screen_share'));
  assert.ok(published.some(({track,options})=>track===audioTrack&&options.source==='screen_share_audio'&&options.stream==='dizy-screen-share'));
  assert.equal(h.api.state.screenAudioState,'published');
  assert.equal(h.api.state.stage.dataset.presentation,'screen-share');
  assert.equal(h.api.state.screenButton.textContent,'Stop Screen');
  await h.api.stopScreenShare();h.flush();
  assert.equal(stops,2);
  assert.equal(h.api.state.stage.dataset.presentation,'audio');
  room.emit('disconnected');h.flush();
  assert.equal(h.api.state.room,null);
  assert.equal(h.api.state.screenButton.disabled,true);
  const next=connect(h);assert.notEqual(next,room);
  assert.equal(h.api.state.screenButton.disabled,false);
});
