'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const iosRoot = path.join(root, 'ios');
const appRoot = path.join(iosRoot, 'App', 'App');
const projectFile = path.join(iosRoot, 'App', 'App.xcodeproj', 'project.pbxproj');
const storyboardFile = path.join(appRoot, 'Base.lproj', 'Main.storyboard');
const plistFile = path.join(appRoot, 'Info.plist');
const appDelegateFile = path.join(appRoot, 'AppDelegate.swift');

const required = [projectFile, storyboardFile, plistFile, appDelegateFile];
for (const file of required) {
  if (!fs.existsSync(file)) {
    throw new Error(`Generated Capacitor iOS file not found: ${path.relative(root, file)}`);
  }
}

const swiftFiles = {
  'DizyBridgeViewController.swift': `import Capacitor\n\nfinal class DizyBridgeViewController: CAPBridgeViewController {\n    override public func capacitorDidLoad() {\n        bridge?.registerPluginInstance(SecureSessionPlugin())\n        bridge?.registerPluginInstance(MobileShellPlugin())\n        bridge?.registerPluginInstance(DizyPushPlugin())\n        bridge?.registerPluginInstance(WebBundlePlugin())\n    }\n}\n`,
  'SecureSessionPlugin.swift': `import Capacitor\nimport Foundation\nimport Security\n\n@objc(SecureSessionPlugin)\npublic final class SecureSessionPlugin: CAPPlugin, CAPBridgedPlugin {\n    public let identifier = "SecureSessionPlugin"\n    public let jsName = "SecureSession"\n    public let pluginMethods: [CAPPluginMethod] = [\n        CAPPluginMethod(name: "readToken", returnType: CAPPluginReturnPromise),\n        CAPPluginMethod(name: "writeToken", returnType: CAPPluginReturnPromise),\n        CAPPluginMethod(name: "clearToken", returnType: CAPPluginReturnPromise),\n    ]\n\n    private static let service = "com.chat.dizychat.session"\n    private static let account = "dizychat-account-session-v2"\n\n    private static func baseQuery() -> [String: Any] {\n        [\n            kSecClass as String: kSecClassGenericPassword,\n            kSecAttrService as String: service,\n            kSecAttrAccount as String: account,\n        ]\n    }\n\n    static func readStoredToken() -> String {\n        var query = baseQuery()\n        query[kSecReturnData as String] = true\n        query[kSecMatchLimit as String] = kSecMatchLimitOne\n        var result: CFTypeRef?\n        let status = SecItemCopyMatching(query as CFDictionary, &result)\n        guard status == errSecSuccess, let data = result as? Data else { return "" }\n        return String(data: data, encoding: .utf8) ?? ""\n    }\n\n    static func writeStoredToken(_ token: String) throws {\n        let value = token.trimmingCharacters(in: .whitespacesAndNewlines)\n        if value.isEmpty {\n            clearStoredToken()\n            return\n        }\n\n        let query = baseQuery()\n        let attrs: [String: Any] = [\n            kSecValueData as String: Data(value.utf8),\n            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,\n        ]\n        let updated = SecItemUpdate(query as CFDictionary, attrs as CFDictionary)\n        if updated == errSecSuccess { return }\n        guard updated == errSecItemNotFound else {\n            throw NSError(domain: NSOSStatusErrorDomain, code: Int(updated))\n        }\n\n        var item = query\n        attrs.forEach { item[$0.key] = $0.value }\n        let added = SecItemAdd(item as CFDictionary, nil)\n        guard added == errSecSuccess else {\n            throw NSError(domain: NSOSStatusErrorDomain, code: Int(added))\n        }\n    }\n\n    static func clearStoredToken() {\n        SecItemDelete(baseQuery() as CFDictionary)\n    }\n\n    @objc public func readToken(_ call: CAPPluginCall) {\n        call.resolve(["token": Self.readStoredToken()])\n    }\n\n    @objc public func writeToken(_ call: CAPPluginCall) {\n        do {\n            try Self.writeStoredToken(call.getString("token") ?? "")\n            call.resolve()\n        } catch {\n            call.reject("Unable to persist secure DizyChat session", nil, error)\n        }\n    }\n\n    @objc public func clearToken(_ call: CAPPluginCall) {\n        Self.clearStoredToken()\n        call.resolve()\n    }\n}\n`,
  'MobileShellPlugin.swift': `import Capacitor\nimport Foundation\nimport UIKit\n\n@objc(MobileShellPlugin)\npublic final class MobileShellPlugin: CAPPlugin, CAPBridgedPlugin {\n    public let identifier = "MobileShellPlugin"\n    public let jsName = "MobileShell"\n    public let pluginMethods: [CAPPluginMethod] = [\n        CAPPluginMethod(name: "openExternal", returnType: CAPPluginReturnPromise),\n    ]\n\n    @objc public func openExternal(_ call: CAPPluginCall) {\n        let raw = (call.getString("url") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)\n        guard let url = URL(string: raw), ["http", "https"].contains(url.scheme?.lowercased() ?? "") else {\n            call.reject("Only HTTP(S) links can be opened externally.")\n            return\n        }\n\n        DispatchQueue.main.async {\n            UIApplication.shared.open(url, options: [:]) { opened in\n                if opened { call.resolve() }\n                else { call.reject("Unable to open external link.") }\n            }\n        }\n    }\n}\n`,
  'DizyPushPlugin.swift': `import Capacitor\nimport Foundation\nimport UIKit\nimport UserNotifications\n\n#if canImport(FirebaseCore)\nimport FirebaseCore\n#endif\n#if canImport(FirebaseMessaging)\nimport FirebaseMessaging\n#endif\n\n@objc(DizyPushPlugin)\npublic final class DizyPushPlugin: CAPPlugin, CAPBridgedPlugin, UNUserNotificationCenterDelegate {\n    public let identifier = "DizyPushPlugin"\n    public let jsName = "DizyPush"\n    public let pluginMethods: [CAPPluginMethod] = [\n        CAPPluginMethod(name: "configure", returnType: CAPPluginReturnPromise),\n        CAPPluginMethod(name: "getRegistration", returnType: CAPPluginReturnPromise),\n        CAPPluginMethod(name: "requestNotificationPermission", returnType: CAPPluginReturnPromise),\n        CAPPluginMethod(name: "isScreenOn", returnType: CAPPluginReturnPromise),\n        CAPPluginMethod(name: "consumeLaunchRoute", returnType: CAPPluginReturnPromise),\n        CAPPluginMethod(name: "listNotificationRooms", returnType: CAPPluginReturnPromise),\n        CAPPluginMethod(name: "applyReadCursor", returnType: CAPPluginReturnPromise),\n    ]\n\n    private static let deviceIdKey = "dizychat.ios.device-id"\n    private static let backendKey = "dizychat.ios.backend-origin"\n    private static let routeRoomKey = "dizychat.ios.route-room"\n    private static let routeMessageKey = "dizychat.ios.route-message"\n\n    public override func load() {\n        super.load()\n        UNUserNotificationCenter.current().delegate = self\n        configureFirebaseIfAvailable()\n    }\n\n    private func configureFirebaseIfAvailable() {\n        #if canImport(FirebaseCore)\n        if FirebaseApp.app() == nil,\n           Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil {\n            FirebaseApp.configure()\n        }\n        #endif\n    }\n\n    private static func deviceId() -> String {\n        if let existing = UserDefaults.standard.string(forKey: deviceIdKey), !existing.isEmpty { return existing }\n        let created = UUID().uuidString.lowercased()\n        UserDefaults.standard.set(created, forKey: deviceIdKey)\n        return created\n    }\n\n    private static func normalizedOrigin(_ raw: String) -> String? {\n        guard var parts = URLComponents(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),\n              let scheme = parts.scheme?.lowercased(), ["http", "https"].contains(scheme),\n              parts.host != nil else { return nil }\n        parts.path = ""\n        parts.query = nil\n        parts.fragment = nil\n        return parts.url?.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))\n    }\n\n    @objc public func configure(_ call: CAPPluginCall) {\n        guard let origin = Self.normalizedOrigin(call.getString("backendOrigin") ?? "") else {\n            call.reject("Invalid DizyChat backend origin")\n            return\n        }\n        UserDefaults.standard.set(origin, forKey: Self.backendKey)\n        call.resolve()\n    }\n\n    @objc public func getRegistration(_ call: CAPPluginCall) {\n        configureFirebaseIfAvailable()\n        #if canImport(FirebaseMessaging)\n        guard FirebaseApp.app() != nil else {\n            call.reject("Firebase iOS configuration is not installed yet")\n            return\n        }\n        Messaging.messaging().token { token, error in\n            if let error = error {\n                call.reject("Unable to obtain FCM token", nil, error)\n                return\n            }\n            guard let token = token?.trimmingCharacters(in: .whitespacesAndNewlines), !token.isEmpty else {\n                call.reject("Unable to obtain FCM token")\n                return\n            }\n            call.resolve(["deviceId": Self.deviceId(), "fcmToken": token])\n        }\n        #else\n        call.reject("Firebase Messaging is not linked into this build yet")\n        #endif\n    }\n\n    @objc public func requestNotificationPermission(_ call: CAPPluginCall) {\n        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, error in\n            if let error = error {\n                call.reject("Unable to request notification permission", nil, error)\n                return\n            }\n            DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }\n            call.resolve(["state": granted ? "granted" : "denied"])\n        }\n    }\n\n    @objc public func isScreenOn(_ call: CAPPluginCall) {\n        DispatchQueue.main.async {\n            call.resolve(["on": UIApplication.shared.applicationState == .active])\n        }\n    }\n\n    @objc public func consumeLaunchRoute(_ call: CAPPluginCall) {\n        let defaults = UserDefaults.standard\n        let room = defaults.string(forKey: Self.routeRoomKey) ?? ""\n        let messageId = defaults.string(forKey: Self.routeMessageKey) ?? ""\n        defaults.removeObject(forKey: Self.routeRoomKey)\n        defaults.removeObject(forKey: Self.routeMessageKey)\n        call.resolve(["room": room, "messageId": messageId])\n    }\n\n    @objc public func listNotificationRooms(_ call: CAPPluginCall) {\n        UNUserNotificationCenter.current().getDeliveredNotifications { notifications in\n            let rooms = Array(Set(notifications.compactMap { $0.request.content.userInfo["room"] as? String }.filter { !$0.isEmpty })).sorted()\n            call.resolve(["rooms": rooms])\n        }\n    }\n\n    @objc public func applyReadCursor(_ call: CAPPluginCall) {\n        guard let room = call.getString("room"), !room.isEmpty else {\n            call.reject("room is required")\n            return\n        }\n        let cursorTimestamp = call.getString("messageTimestamp") ?? ""\n        UNUserNotificationCenter.current().getDeliveredNotifications { notifications in\n            let identifiers = notifications.compactMap { item -> String? in\n                let info = item.request.content.userInfo\n                guard (info["room"] as? String) == room else { return nil }\n                let timestamp = (info["timestamp"] as? String) ?? ""\n                if cursorTimestamp.isEmpty || timestamp.isEmpty || timestamp <= cursorTimestamp {\n                    return item.request.identifier\n                }\n                return nil\n            }\n            if !identifiers.isEmpty {\n                UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: identifiers)\n            }\n            call.resolve(["cleared": !identifiers.isEmpty])\n        }\n    }\n\n    public func userNotificationCenter(_ center: UNUserNotificationCenter,\n                                       didReceive response: UNNotificationResponse,\n                                       withCompletionHandler completionHandler: @escaping () -> Void) {\n        let info = response.notification.request.content.userInfo\n        let room = String(describing: info["room"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)\n        let messageId = String(describing: info["messageId"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)\n        if !room.isEmpty {\n            UserDefaults.standard.set(room, forKey: Self.routeRoomKey)\n            UserDefaults.standard.set(messageId, forKey: Self.routeMessageKey)\n            notifyListeners("notificationRoute", data: ["room": room, "messageId": messageId], retainUntilConsumed: true)\n        }\n        completionHandler()\n    }\n}\n`,
};
swiftFiles['WebBundlePlugin.swift'] = fs.readFileSync(
  path.join(root, 'ios-native', 'WebBundlePlugin.swift'),
  'utf8',
);

for (const [name, content] of Object.entries(swiftFiles)) {
  fs.writeFileSync(path.join(appRoot, name), content);
}

let project = fs.readFileSync(projectFile, 'utf8');
const entries = [
  ['D1ZY00000000000000000001', 'D1ZY00000000000000000101', 'DizyBridgeViewController.swift'],
  ['D1ZY00000000000000000002', 'D1ZY00000000000000000102', 'SecureSessionPlugin.swift'],
  ['D1ZY00000000000000000003', 'D1ZY00000000000000000103', 'MobileShellPlugin.swift'],
  ['D1ZY00000000000000000004', 'D1ZY00000000000000000104', 'DizyPushPlugin.swift'],
  ['D1ZY00000000000000000005', 'D1ZY00000000000000000105', 'WebBundlePlugin.swift'],
];

if (!project.includes('DizyBridgeViewController.swift')) {
  const buildNeedle = '\t\t504EC3081FED79650016851F /* AppDelegate.swift in Sources */ = {isa = PBXBuildFile; fileRef = 504EC3071FED79650016851F /* AppDelegate.swift */; };\n';
  const buildInsert = entries.map(([ref, build, name]) => `\t\t${build} /* ${name} in Sources */ = {isa = PBXBuildFile; fileRef = ${ref} /* ${name} */; };\n`).join('');
  if (!project.includes(buildNeedle)) throw new Error('Unable to patch iOS PBXBuildFile section');
  project = project.replace(buildNeedle, buildNeedle + buildInsert);

  const refNeedle = '\t\t504EC3071FED79650016851F /* AppDelegate.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = AppDelegate.swift; sourceTree = "<group>"; };\n';
  const refInsert = entries.map(([ref, , name]) => `\t\t${ref} /* ${name} */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = ${name}; sourceTree = "<group>"; };\n`).join('');
  if (!project.includes(refNeedle)) throw new Error('Unable to patch iOS PBXFileReference section');
  project = project.replace(refNeedle, refNeedle + refInsert);

  const groupNeedle = '\t\t\t\t504EC3071FED79650016851F /* AppDelegate.swift */,\n';
  const groupInsert = entries.map(([ref, , name]) => `\t\t\t\t${ref} /* ${name} */,\n`).join('');
  if (!project.includes(groupNeedle)) throw new Error('Unable to patch iOS App group');
  project = project.replace(groupNeedle, groupNeedle + groupInsert);

  const sourceNeedle = '\t\t\t\t504EC3081FED79650016851F /* AppDelegate.swift in Sources */,\n';
  const sourceInsert = entries.map(([, build, name]) => `\t\t\t\t${build} /* ${name} in Sources */,\n`).join('');
  if (!project.includes(sourceNeedle)) throw new Error('Unable to patch iOS Sources build phase');
  project = project.replace(sourceNeedle, sourceNeedle + sourceInsert);
  fs.writeFileSync(projectFile, project);
}

let appDelegate = fs.readFileSync(appDelegateFile, 'utf8');
if (!appDelegate.includes('didRegisterForRemoteNotificationsWithDeviceToken')) {
  appDelegate = appDelegate.replace(
    'import Capacitor\n',
    'import Capacitor\n\n#if canImport(FirebaseMessaging)\nimport FirebaseMessaging\n#endif\n',
  );
  const finalBrace = '\n}\n';
  const methods = `
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(
            name: .capacitorDidRegisterForRemoteNotifications,
            object: deviceToken
        )
        #if canImport(FirebaseMessaging)
        Messaging.messaging().apnsToken = deviceToken
        #endif
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(
            name: .capacitorDidFailToRegisterForRemoteNotifications,
            object: error
        )
    }
`;
  const position = appDelegate.lastIndexOf(finalBrace);
  if (position < 0) throw new Error('Unable to patch iOS AppDelegate push callbacks');
  appDelegate = appDelegate.slice(0, position) + '\n' + methods + appDelegate.slice(position);
  fs.writeFileSync(appDelegateFile, appDelegate);
}

let storyboard = fs.readFileSync(storyboardFile, 'utf8');
storyboard = storyboard.replace(
  'customClass="CAPBridgeViewController" customModule="Capacitor"',
  'customClass="DizyBridgeViewController" customModule="App" customModuleProvider="target"',
);
fs.writeFileSync(storyboardFile, storyboard);

let plist = fs.readFileSync(plistFile, 'utf8');
if (!plist.includes('<key>NSCameraUsageDescription</key>')) {
  const needle = '\t<key>LSRequiresIPhoneOS</key>\n\t<true/>\n';
  const permissions = '\t<key>NSCameraUsageDescription</key>\n\t<string>DizyChat uses the camera for video calls and camera sharing.</string>\n\t<key>NSMicrophoneUsageDescription</key>\n\t<string>DizyChat uses the microphone for voice messages and calls.</string>\n';
  if (!plist.includes(needle)) throw new Error('Unable to patch iOS Info.plist permissions');
  plist = plist.replace(needle, permissions + needle);
  fs.writeFileSync(plistFile, plist);
}

console.log('Prepared DizyChat native iOS bridge (Keychain, external links, permissions, verified web bundles, Firebase-ready push).');
