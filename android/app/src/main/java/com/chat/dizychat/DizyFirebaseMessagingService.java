package com.chat.dizychat;

import android.util.Log;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

public class DizyFirebaseMessagingService extends FirebaseMessagingService {
    private static final String TAG = "DizyPushTrace";
    @Override
    public void onCreate() {
        super.onCreate();
        Log.i(TAG, "service onCreate");
        DizyNotificationManager.ensureChannel(this);
    }

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        Log.i(TAG, "onMessageReceived id=" + clean(remoteMessage.getMessageId())
                + " senderId=" + clean(remoteMessage.getFrom())
                + " priority=" + remoteMessage.getPriority()
                + " originalPriority=" + remoteMessage.getOriginalPriority());
        Map<String, String> data = remoteMessage.getData();
        if (data == null || data.isEmpty()) {
            Log.w(TAG, "drop: empty data payload");
            return;
        }
        Log.i(TAG, "data keys=" + data.keySet());

        String type = clean(data.get("type"));
        String room = clean(data.get("room"));
        String messageId = clean(data.get("messageId"));
        String notificationKey = clean(data.get("notificationKey"));
        String timestamp = clean(data.get("timestamp"));

        if ("activity".equals(type)) {
            String activityId = clean(data.get("activityId"));
            String activityType = clean(data.get("activityType"));
            if (room.isEmpty() || activityId.isEmpty() || activityType.isEmpty()
                    || notificationKey.isEmpty() || timestamp.isEmpty()) {
                Log.w(TAG, "drop: activity required field missing room=" + !room.isEmpty()
                        + " activityId=" + !activityId.isEmpty()
                        + " activityType=" + !activityType.isEmpty()
                        + " notificationKey=" + !notificationKey.isEmpty()
                        + " timestamp=" + !timestamp.isEmpty());
                return;
            }
            Log.i(TAG, "dispatch activity room=" + room + " type=" + activityType);
            DizyNotificationManager.showActivityNotification(
                    this,
                    room,
                    activityId,
                    activityType,
                    clean(data.get("sender")),
                    clean(data.get("preview")),
                    notificationKey,
                    timestamp
            );
            return;
        }

        if (room.isEmpty() || messageId.isEmpty() || notificationKey.isEmpty() || timestamp.isEmpty()) {
            Log.w(TAG, "drop: required field missing type=" + type
                    + " room=" + !room.isEmpty()
                    + " messageId=" + !messageId.isEmpty()
                    + " notificationKey=" + !notificationKey.isEmpty()
                    + " timestamp=" + !timestamp.isEmpty());
            return;
        }

        if ("read-control".equals(type)) {
            Log.i(TAG, "dispatch read-control room=" + room);
            DizyNotificationManager.applyReadControl(
                    this,
                    room,
                    messageId,
                    notificationKey,
                    timestamp
            );
            return;
        }

        if (!type.isEmpty() && !"message".equals(type)) {
            Log.w(TAG, "drop: unsupported type=" + type);
            return;
        }
        Log.i(TAG, "dispatch message room=" + room);
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
        DizyPushTrace.token("onNewToken", token);
        DizyPushPlugin.notifyTokenChanged(this, token);
    }

    private static String clean(String value) {
        return value == null ? "" : value.trim();
    }
}
