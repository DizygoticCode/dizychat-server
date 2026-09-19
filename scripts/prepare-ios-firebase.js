'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const podfilePath = path.join(root, 'ios', 'App', 'Podfile');
const projectPath = path.join(root, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');

for (const file of [podfilePath, projectPath]) {
  if (!fs.existsSync(file)) {
    throw new Error(`Generated Capacitor iOS file not found: ${path.relative(root, file)}`);
  }
}

let podfile = fs.readFileSync(podfilePath, 'utf8');
podfile = podfile.replace("platform :ios, '14.0'", "platform :ios, '15.0'");
if (!podfile.includes("pod 'FirebaseMessaging', '12.19.0'")) {
  const anchor = "  # Add your Pods here\n";
  if (!podfile.includes(anchor)) throw new Error('Unable to patch generated iOS Podfile');
  podfile = podfile.replace(
    anchor,
    "  pod 'FirebaseCore', '12.19.0'\n  pod 'FirebaseMessaging', '12.19.0'\n" + anchor,
  );
}
fs.writeFileSync(podfilePath, podfile);

let project = fs.readFileSync(projectPath, 'utf8');
project = project.replaceAll('IPHONEOS_DEPLOYMENT_TARGET = 14.0;', 'IPHONEOS_DEPLOYMENT_TARGET = 15.0;');
fs.writeFileSync(projectPath, project);

console.log('Prepared Firebase Messaging dependencies for iOS 15+ (Firebase Apple SDK 12.19.0).');
