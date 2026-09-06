package com.chat.dizychat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

public class DizyFirebaseMessagingService extends FirebaseMessagingService {
    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        if (data == null || data.isEmpty()) return;
        String room = clean(data.get("room"));
        String messageId = clean(data.get("messageId"));
        if (room.isEmpty() || messageId.isEmpty()) return;
        DizyNotificationManager.showMessageNotification(
                this,
                room,
                messageId,
                clean(data.get("sender")),
                clean(data.get("preview")),
                clean(data.get("notificationKey")),
                clean(data.get("timestamp"))
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
