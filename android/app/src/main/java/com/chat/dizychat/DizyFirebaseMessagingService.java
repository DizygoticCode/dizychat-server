package com.chat.dizychat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

public class DizyFirebaseMessagingService extends FirebaseMessagingService {
    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        if (data == null || data.isEmpty()) return;

        String type = clean(data.get("type"));
        String room = clean(data.get("room"));
        String messageId = clean(data.get("messageId"));
        String notificationKey = clean(data.get("notificationKey"));
        String timestamp = clean(data.get("timestamp"));
        if (room.isEmpty() || messageId.isEmpty() || notificationKey.isEmpty() || timestamp.isEmpty()) return;

        if ("read-control".equals(type)) {
            DizyNotificationManager.applyReadControl(
                    this,
                    room,
                    messageId,
                    notificationKey,
                    timestamp
            );
            return;
        }

        if (!type.isEmpty() && !"message".equals(type)) return;
        DizyNotificationManager.showMessageNotification(
                this,
                room,
                messageId,
                clean(data.get("sender")),
                clean(data.get("preview")),
                notificationKey,
                timestamp
        );
    }

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        DizyPushPlugin.notifyTokenChanged(this, token);
    }

    private static String clean(String value) {
        return value == null ? "" : value.trim();
    }
}
