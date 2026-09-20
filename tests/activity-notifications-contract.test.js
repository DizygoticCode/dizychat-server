'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('room activity starts are wired from successful voice jam webcam watch party and screen-share events', () => {
  const server = read('server-core.js');
  const chat = read('public/chat.js');
  const embedded = read('public/embedded-call-view.js');

  assert.match(chat, /socket\.emit\("call:join",\s*\{[\s\S]*mode:\s*requestedMusicMode\s*\?\s*"jam"\s*:\s*"voice"/);
  assert.match(chat, /socket\.emit\("call:media-start",\s*\{\s*room:\s*window\.currentRoom,\s*kind:\s*"video"/);
  assert.match(embedded, /state\.localScreenPublication\s*=\s*publication;[\s\S]*call:media-start[\s\S]*kind:\s*'screen-share'/);

  assert.match(server, /activityType:\s*'watch-party'/);
  assert.match(server, /activityType:\s*'jam'/);
  assert.match(server, /socket\.on\('call:media-start'/);
  assert.match(server, /\['video', 'screen-share'\]\.includes\(activityType\)/);
  assert.match(server, /notifyRoomActivity\([\s\S]*activityId:\s*state\.callId/);
});

test('activity pushes fan out to native and Web Push including desktop and Home Screen clients', () => {
  const server = read('server-core.js');
  const web = read('src/push/web-push-coordinator.js');
  const serviceWorker = read('public/dizychat-sw.js');
  const androidService = read('android/app/src/main/java/com/chat/dizychat/DizyFirebaseMessagingService.java');
  const androidNotifications = read('android/app/src/main/java/com/chat/dizychat/DizyNotificationManager.java');

  assert.match(server, /nativePushCoordinator\.onActivityStarted/);
  assert.match(server, /webPushCoordinator\.onActivityStarted/);
  assert.match(web, /type:\s*'activity'/);
  assert.match(web, /Tap to open DizyChat/);
  assert.match(serviceWorker, /type\s*===\s*'activity'/);
  assert.match(serviceWorker, /options\.vibrate\s*=\s*\[180, 120, 180\]/);
  assert.match(androidService, /"activity"\.equals\(type\)/);
  assert.match(androidNotifications, /ACTIVITY_CHANNEL_ID\s*=\s*"dizychat_activities_v1"/);
});
