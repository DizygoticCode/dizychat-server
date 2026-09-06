package com.chat.dizychat;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;
import androidx.core.app.RemoteInput;
import androidx.core.content.ContextCompat;

final class DizyNotificationManager {
    static final String CHANNEL_ID = "dizychat_messages_v1";
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
        if (!canNotify(context)) return;
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
            if (state != null) renderState(context, state, true);
        } catch (RuntimeException ignored) {
            // Invalid/stale notification data fails safe without altering other room state.
        }
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
        if (latest == null) return;

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

        NotificationManagerCompat.from(context).notify(notificationId, builder.build());
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

    private static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "DizyChat messages",
                NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Messages from subscribed DizyChat rooms");
        manager.createNotificationChannel(channel);
    }
}
