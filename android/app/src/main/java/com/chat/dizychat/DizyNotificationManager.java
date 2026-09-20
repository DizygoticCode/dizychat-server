package com.chat.dizychat;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;
import androidx.core.app.RemoteInput;
import androidx.core.content.ContextCompat;

final class DizyNotificationManager {
    private static final String TAG = "DizyPushTrace";
    static final String CHANNEL_ID = "dizychat_messages_v2";
    static final String ACTIVITY_CHANNEL_ID = "dizychat_activities_v1";
    private static final int ACTIVITY_NOTIFICATION_PREFIX = 0x23000000;
    static final String EXTRA_NOTIFICATION_ID = "dizy_notification_id";
    static final String REMOTE_INPUT_KEY = "dizy_reply_text";

    private DizyNotificationManager() {}

    static void showMessageNotification(
            Context context,
            String room,
            String messageId,
            String sender,
            String preview,
            String notificationKey,
            String timestamp
    ) {
        if (!canNotify(context)) {
            Log.w(TAG, "showMessageNotification blocked: canNotify=false");
            return;
        }
        Log.i(TAG, "showMessageNotification start room=" + room);
        try {
            DizyNotificationStateStore.RoomState state = DizyNotificationStateStore.recordMessage(
                    context,
                    room,
                    messageId,
                    sender,
                    preview,
                    notificationKey,
                    timestamp
            );
            if (state == null) {
                Log.w(TAG, "recordMessage returned null");
                return;
            }
            Log.i(TAG, "recordMessage ok notificationId=" + state.notificationId);
            renderState(context, state, true);
        } catch (RuntimeException error) {
            Log.e(TAG, "showMessageNotification failed: " + error.getClass().getSimpleName()
                    + ": " + String.valueOf(error.getMessage()));
        }
    }

    static void showActivityNotification(
            Context context,
            String room,
            String activityId,
            String activityType,
            String sender,
            String preview,
            String notificationKey,
            String timestamp
    ) {
        if (!canNotify(context)) {
            Log.w(TAG, "showActivityNotification blocked: canNotify=false");
            return;
        }
        String cleanRoom = clean(room);
        String cleanActivityId = clean(activityId);
        String cleanType = clean(activityType);
        String cleanKey = clean(notificationKey);
        if (cleanRoom.isEmpty() || cleanActivityId.isEmpty() || cleanType.isEmpty() || cleanKey.isEmpty()) {
            Log.w(TAG, "showActivityNotification dropped: required field missing");
            return;
        }

        ensureChannel(context);
        int notificationId = ACTIVITY_NOTIFICATION_PREFIX | (cleanKey.hashCode() & 0x00ffffff);
        Intent tapIntent = new Intent(context, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(DizyPushPlugin.EXTRA_ROOM, cleanRoom)
                .putExtra(DizyPushPlugin.EXTRA_MESSAGE_ID, "")
                .putExtra(DizyPushPlugin.EXTRA_ACTIVITY_TYPE, cleanType);
        PendingIntent tapPendingIntent = PendingIntent.getActivity(
                context,
                notificationId,
                tapIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String cleanSender = clean(sender);
        String cleanPreview = clean(preview);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, ACTIVITY_CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle((cleanSender.isEmpty() ? "Someone" : cleanSender) + " · " + cleanRoom)
                .setContentText(cleanPreview.isEmpty() ? "Started a DizyChat activity" : cleanPreview)
                .setContentIntent(tapPendingIntent)
                .setAutoCancel(true)
                .setCategory(NotificationCompat.CATEGORY_EVENT)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setOnlyAlertOnce(true)
                .setTimeoutAfter(120000L)
                .setWhen(DizyNotificationStateStore.timestampMillis(timestamp));

        Log.i(TAG, "notify activity id=" + notificationId + " room=" + cleanRoom + " type=" + cleanType);
        NotificationManagerCompat.from(context).notify(notificationId, builder.build());
    }

    static boolean applyReadControl(
            Context context,
            String room,
            String messageId,
            String notificationKey,
            String timestamp
    ) {
        try {
            DizyNotificationStateStore.ReconcileResult result = DizyNotificationStateStore.applyReadCursor(
                    context,
                    room,
                    notificationKey,
                    messageId,
                    timestamp
            );
            if (result.status == DizyNotificationStateStore.ReconcileStatus.CLEARED) {
                cancel(context, result.notificationId);
                return true;
            }
            if (result.status == DizyNotificationStateStore.ReconcileStatus.UPDATED
                    && result.state != null
                    && canNotify(context)) {
                renderState(context, result.state, false);
            }
            return false;
        } catch (RuntimeException ignored) {
            // A malformed or out-of-order control must never clear unread state by guessing.
            return false;
        }
    }

    static void cancel(Context context, int notificationId) {
        NotificationManagerCompat.from(context).cancel(notificationId);
    }

    private static void renderState(
            Context context,
            DizyNotificationStateStore.RoomState state,
            boolean alert
    ) {
        ensureChannel(context);
        DizyNotificationStateStore.Entry latest = latestEntry(state);
        if (latest == null) {
            Log.w(TAG, "renderState aborted: no latest entry");
            return;
        }

        int notificationId = state.notificationId;
        Intent tapIntent = new Intent(context, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(DizyPushPlugin.EXTRA_ROOM, state.room)
                .putExtra(DizyPushPlugin.EXTRA_MESSAGE_ID, state.latestMessageId);
        PendingIntent tapPendingIntent = PendingIntent.getActivity(
                context,
                notificationId,
                tapIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        RemoteInput remoteInput = new RemoteInput.Builder(REMOTE_INPUT_KEY)
                .setLabel("Reply")
                .build();
        Intent replyIntent = actionIntent(
                context,
                DizyNotificationActionReceiver.ACTION_REPLY,
                state.room,
                state.latestMessageId,
                notificationId
        );
        PendingIntent replyPendingIntent = PendingIntent.getBroadcast(
                context,
                notificationId ^ 0x22000000,
                replyIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE
        );
        NotificationCompat.Action replyAction = new NotificationCompat.Action.Builder(
                android.R.drawable.ic_menu_send,
                "Reply",
                replyPendingIntent
        ).addRemoteInput(remoteInput).build();

        Intent readIntent = actionIntent(
                context,
                DizyNotificationActionReceiver.ACTION_MARK_READ,
                state.room,
                state.latestMessageId,
                notificationId
        );
        PendingIntent readPendingIntent = PendingIntent.getBroadcast(
                context,
                notificationId ^ 0x44000000,
                readIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        NotificationCompat.Action readAction = new NotificationCompat.Action.Builder(
                android.R.drawable.checkbox_on_background,
                "Mark as read",
                readPendingIntent
        ).build();

        Person localUser = new Person.Builder().setName("You").build();
        NotificationCompat.MessagingStyle style = new NotificationCompat.MessagingStyle(localUser)
                .setConversationTitle(state.room)
                .setGroupConversation(true);
        for (DizyNotificationStateStore.Entry entry : state.entries) {
            String sender = entry.sender.isEmpty() ? "DizyChat" : entry.sender;
            Person person = new Person.Builder().setName(sender).build();
            style.addMessage(
                    entry.preview,
                    DizyNotificationStateStore.timestampMillis(entry.timestamp),
                    person
            );
        }

        String cleanSender = latest.sender.isEmpty() ? "DizyChat" : latest.sender;
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(cleanSender + " · " + state.room)
                .setContentText(latest.preview)
                .setStyle(style)
                .setContentIntent(tapPendingIntent)
                .setAutoCancel(false)
                .setOnlyAlertOnce(!alert)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setGroup("dizychat-room-" + state.notificationKey)
                .setWhen(DizyNotificationStateStore.timestampMillis(state.latestTimestamp))
                .addAction(replyAction)
                .addAction(readAction);

        Log.i(TAG, "notify start id=" + notificationId + " room=" + state.room);
        NotificationManagerCompat.from(context).notify(notificationId, builder.build());
        Log.i(TAG, "notify complete id=" + notificationId);
    }

    private static DizyNotificationStateStore.Entry latestEntry(DizyNotificationStateStore.RoomState state) {
        for (int index = state.entries.size() - 1; index >= 0; index -= 1) {
            DizyNotificationStateStore.Entry entry = state.entries.get(index);
            if (state.latestMessageId.equalsIgnoreCase(entry.messageId)) return entry;
        }
        return state.entries.isEmpty() ? null : state.entries.get(state.entries.size() - 1);
    }

    private static Intent actionIntent(Context context, String action, String room, String messageId, int notificationId) {
        return new Intent(context, DizyNotificationActionReceiver.class)
                .setAction(action)
                .putExtra(DizyPushPlugin.EXTRA_ROOM, room)
                .putExtra(DizyPushPlugin.EXTRA_MESSAGE_ID, messageId)
                .putExtra(EXTRA_NOTIFICATION_ID, notificationId);
    }

    private static boolean canNotify(Context context) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) {
            Log.w(TAG, "ensureChannel: NotificationManager unavailable");
            return;
        }

        if (manager.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel messageChannel = new NotificationChannel(
                    CHANNEL_ID,
                    "DizyChat messages",
                    NotificationManager.IMPORTANCE_HIGH
            );
            messageChannel.setDescription("Messages from subscribed DizyChat rooms");
            messageChannel.enableVibration(true);
            messageChannel.setVibrationPattern(new long[]{0, 180, 120, 180});
            manager.createNotificationChannel(messageChannel);
            Log.i(TAG, "ensureChannel: created " + CHANNEL_ID);
        } else {
            Log.i(TAG, "ensureChannel: existing " + CHANNEL_ID);
        }

        if (manager.getNotificationChannel(ACTIVITY_CHANNEL_ID) == null) {
            NotificationChannel activityChannel = new NotificationChannel(
                    ACTIVITY_CHANNEL_ID,
                    "DizyChat activities",
                    NotificationManager.IMPORTANCE_HIGH
            );
            activityChannel.setDescription("Voice, video, jam, watch party and screen share activity");
            activityChannel.enableVibration(true);
            activityChannel.setVibrationPattern(new long[]{0, 180, 120, 180});
            manager.createNotificationChannel(activityChannel);
            Log.i(TAG, "ensureChannel: created " + ACTIVITY_CHANNEL_ID);
        } else {
            Log.i(TAG, "ensureChannel: existing " + ACTIVITY_CHANNEL_ID);
        }
    }

    private static String clean(String value) {
        return value == null ? "" : value.trim();
    }
}
