import Capacitor
import FirebaseCore
import FirebaseMessaging
import Foundation
import UIKit
import UserNotifications

@objc(DizyPushPlugin)
public final class DizyPushPlugin: CAPPlugin, CAPBridgedPlugin, UNUserNotificationCenterDelegate, MessagingDelegate {
    public let identifier = "DizyPushPlugin"
    public let jsName = "DizyPush"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "configure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getRegistration", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestNotificationPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isScreenOn", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "consumeLaunchRoute", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listNotificationRooms", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "applyReadCursor", returnType: CAPPluginReturnPromise),
    ]

    private static let deviceIdKey = "dizychat.ios.device-id"
    private static let backendKey = "dizychat.ios.backend-origin"
    private static let routeRoomKey = "dizychat.ios.route-room"
    private static let routeMessageKey = "dizychat.ios.route-message"
    private static let messageCategory = "DIZYCHAT_MESSAGE"
    private static let replyAction = "DIZYCHAT_REPLY"
    private static let markReadAction = "DIZYCHAT_MARK_READ"

    public override func load() {
        super.load()
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        installNotificationCategories(center)
        configureFirebaseIfAvailable()
    }

    private func installNotificationCategories(_ center: UNUserNotificationCenter) {
        let reply = UNTextInputNotificationAction(
            identifier: Self.replyAction,
            title: "Reply",
            options: [],
            textInputButtonTitle: "Send",
            textInputPlaceholder: "Message"
        )
        let markRead = UNNotificationAction(
            identifier: Self.markReadAction,
            title: "Mark as read",
            options: []
        )
        let category = UNNotificationCategory(
            identifier: Self.messageCategory,
            actions: [reply, markRead],
            intentIdentifiers: [],
            options: []
        )
        center.setNotificationCategories([category])
    }

    private func configureFirebaseIfAvailable() {
        if FirebaseApp.app() == nil,
           Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil {
            FirebaseApp.configure()
        }
        if FirebaseApp.app() != nil {
            Messaging.messaging().delegate = self
        }
    }

    private static func deviceId() -> String {
        if let existing = UserDefaults.standard.string(forKey: deviceIdKey), !existing.isEmpty {
            return existing
        }
        let created = UUID().uuidString.lowercased()
        UserDefaults.standard.set(created, forKey: deviceIdKey)
        return created
    }

    private static func normalizedOrigin(_ raw: String) -> String? {
        guard var parts = URLComponents(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = parts.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              parts.host != nil else {
            return nil
        }
        parts.path = ""
        parts.query = nil
        parts.fragment = nil
        return parts.url?.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    @objc public func configure(_ call: CAPPluginCall) {
        guard let origin = Self.normalizedOrigin(call.getString("backendOrigin") ?? "") else {
            call.reject("Invalid DizyChat backend origin")
            return
        }
        UserDefaults.standard.set(origin, forKey: Self.backendKey)
        call.resolve()
    }

    @objc public func getRegistration(_ call: CAPPluginCall) {
        configureFirebaseIfAvailable()
        guard FirebaseApp.app() != nil else {
            call.reject("Firebase iOS configuration is not installed yet")
            return
        }
        Messaging.messaging().delegate = self
        Messaging.messaging().token { token, error in
            if let error = error {
                call.reject("Unable to obtain FCM token", nil, error)
                return
            }
            guard let token = token?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !token.isEmpty else {
                call.reject("Unable to obtain FCM token")
                return
            }
            call.resolve([
                "deviceId": Self.deviceId(),
                "fcmToken": token,
            ])
        }
    }

    @objc public func requestNotificationPermission(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, error in
            if let error = error {
                call.reject("Unable to request notification permission", nil, error)
                return
            }
            if granted {
                DispatchQueue.main.async {
                    UIApplication.shared.registerForRemoteNotifications()
                }
            }
            call.resolve(["state": granted ? "granted" : "denied"])
        }
    }

    @objc public func isScreenOn(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(["on": UIApplication.shared.applicationState == .active])
        }
    }

    @objc public func consumeLaunchRoute(_ call: CAPPluginCall) {
        let defaults = UserDefaults.standard
        let room = defaults.string(forKey: Self.routeRoomKey) ?? ""
        let messageId = defaults.string(forKey: Self.routeMessageKey) ?? ""
        defaults.removeObject(forKey: Self.routeRoomKey)
        defaults.removeObject(forKey: Self.routeMessageKey)
        call.resolve(["room": room, "messageId": messageId])
    }

    @objc public func listNotificationRooms(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getDeliveredNotifications { notifications in
            let rooms = Array(Set(notifications.compactMap {
                Self.cleanString($0.request.content.userInfo["room"])
            }.filter { !$0.isEmpty })).sorted()
            call.resolve(["rooms": rooms])
        }
    }

    @objc public func applyReadCursor(_ call: CAPPluginCall) {
        guard let room = call.getString("room"), !room.isEmpty else {
            call.reject("room is required")
            return
        }
        let cursorTimestamp = call.getString("messageTimestamp") ?? ""
        UNUserNotificationCenter.current().getDeliveredNotifications { notifications in
            let identifiers = notifications.compactMap { item -> String? in
                let info = item.request.content.userInfo
                guard Self.cleanString(info["room"]) == room else { return nil }
                let timestamp = Self.cleanString(info["timestamp"])
                if cursorTimestamp.isEmpty || timestamp.isEmpty || timestamp <= cursorTimestamp {
                    return item.request.identifier
                }
                return nil
            }
            if !identifiers.isEmpty {
                UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: identifiers)
            }
            call.resolve(["cleared": !identifiers.isEmpty])
        }
    }

    public func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        let token = (fcmToken ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty else { return }
        notifyListeners(
            "tokenChanged",
            data: ["fcmToken": token],
            retainUntilConsumed: true
        )
    }

    public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        // Interactive presence suppresses server push while the chat is active.
        // If a race still delivers one, avoid a duplicate foreground banner.
        completionHandler([])
    }

    public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let info = response.notification.request.content.userInfo
        let room = Self.cleanString(info["room"])
        let messageId = Self.cleanString(info["messageId"])

        switch response.actionIdentifier {
        case Self.replyAction:
            guard let textResponse = response as? UNTextInputNotificationResponse else {
                completionHandler()
                return
            }
            let text = textResponse.userText.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !room.isEmpty, !messageId.isEmpty, !text.isEmpty else {
                completionHandler()
                return
            }
            postAuthenticated(
                path: "/api/mobile/push/reply",
                body: [
                    "room": room,
                    "text": text,
                    "replyToMessageId": messageId,
                    "deviceId": Self.deviceId(),
                ]
            ) { _ in
                completionHandler()
            }

        case Self.markReadAction:
            guard !room.isEmpty, !messageId.isEmpty else {
                completionHandler()
                return
            }
            postAuthenticated(
                path: "/api/read-state/mark",
                body: [
                    "room": room,
                    "messageId": messageId,
                ]
            ) { ok in
                if ok {
                    center.removeDeliveredNotifications(
                        withIdentifiers: [response.notification.request.identifier]
                    )
                }
                completionHandler()
            }

        case UNNotificationDismissActionIdentifier:
            completionHandler()

        default:
            if !room.isEmpty {
                Self.storeRoute(room: room, messageId: messageId)
                notifyListeners(
                    "notificationRoute",
                    data: ["room": room, "messageId": messageId],
                    retainUntilConsumed: true
                )
            }
            completionHandler()
        }
    }

    static func handleRemoteNotification(
        _ userInfo: [AnyHashable: Any],
        completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        guard cleanString(userInfo["type"]) == "read-control" else {
            completionHandler(.noData)
            return
        }
        let room = cleanString(userInfo["room"])
        let cursorTimestamp = cleanString(userInfo["timestamp"])
        guard !room.isEmpty else {
            completionHandler(.noData)
            return
        }

        let center = UNUserNotificationCenter.current()
        center.getDeliveredNotifications { notifications in
            let identifiers = notifications.compactMap { item -> String? in
                let info = item.request.content.userInfo
                guard cleanString(info["room"]) == room else { return nil }
                let timestamp = cleanString(info["timestamp"])
                if cursorTimestamp.isEmpty || timestamp.isEmpty || timestamp <= cursorTimestamp {
                    return item.request.identifier
                }
                return nil
            }
            if !identifiers.isEmpty {
                center.removeDeliveredNotifications(withIdentifiers: identifiers)
                completionHandler(.newData)
            } else {
                completionHandler(.noData)
            }
        }
    }

    private func postAuthenticated(
        path: String,
        body: [String: Any],
        completion: @escaping (Bool) -> Void
    ) {
        let token = SecureSessionPlugin.readStoredToken()
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let backend = (UserDefaults.standard.string(forKey: Self.backendKey) ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        guard !token.isEmpty,
              let origin = Self.normalizedOrigin(backend),
              var components = URLComponents(string: origin) else {
            completion(false)
            return
        }
        components.path = path
        guard let url = components.url,
              let payload = try? JSONSerialization.data(withJSONObject: body) else {
            completion(false)
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 20
        request.httpBody = payload
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        URLSession.shared.dataTask(with: request) { _, response, _ in
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            completion((200..<300).contains(status))
        }.resume()
    }

    private static func storeRoute(room: String, messageId: String) {
        UserDefaults.standard.set(room, forKey: routeRoomKey)
        UserDefaults.standard.set(messageId, forKey: routeMessageKey)
    }

    private static func cleanString(_ value: Any?) -> String {
        guard let value = value else { return "" }
        if let string = value as? String {
            return string.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return String(describing: value).trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
